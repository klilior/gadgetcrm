import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, MapPin, Truck, RotateCcw, Package, CheckCircle, Copy, Search, Store, Lock, Printer } from "lucide-react";
import { createShipment } from "@/functions/createShipment";
import { searchPickupPoints } from "@/functions/searchPickupPoints";
import { printShipmentLabel } from "@/functions/printShipmentLabel";
import { toast } from "sonner";

function parsePickupPointData(order) {
  if (!order?.pickup_point_data) return null;
  try {
    let raw = order.pickup_point_data;
    // Handle double-escaped JSON from WooCommerce
    if (typeof raw === 'string') {
      raw = raw.replace(/\\\\/g, '\\');
      if (raw.startsWith('"') && raw.endsWith('"')) {
        raw = raw.slice(1, -1);
      }
      raw = raw.replace(/\\"/g, '"');
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      id: parsed.iid,
      name: parsed.title,
      city: parsed.city,
      street: parsed.street,
      type: parsed.type || 'store',
      hours: parsed.zip || '', // "zip" field actually holds hours in pkps_json
      lat: parsed.lat,
      lng: parsed.lng
    };
  } catch (e) {
    console.error('Failed to parse pickup point data:', e);
    return null;
  }
}

export default function CreateShipmentModal({ open, onClose, order, client, onSuccess }) {
  const [tab, setTab] = useState("pickup_point");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Form fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [house, setHouse] = useState("");
  const [zip, setZip] = useState("");

  // Pickup points
  const [pickupPoints, setPickupPoints] = useState([]);
  const [searchingPoints, setSearchingPoints] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [wooPickupPoint, setWooPickupPoint] = useState(null);

  // Pre-fill from order/client
  useEffect(() => {
    if (!open) {
      setResult(null);
      setSelectedPoint(null);
      setPickupPoints([]);
      setWooPickupPoint(null);
      return;
    }

    let billing = {};
    try { billing = JSON.parse(order?.raw_data_billing || '{}'); } catch {}

    const fullName = client?.full_name || `${billing.first_name || ''} ${billing.last_name || ''}`.trim();
    const phoneNum = client?.phone || billing.phone || '';
    const cityName = billing.city || client?.city || '';
    const streetName = billing.address_1 || '';
    const zipCode = billing.postcode || '';

    setName(fullName);
    setPhone(phoneNum);
    setCity(cityName);
    setStreet(streetName);
    setHouse('');
    setZip(zipCode);

    // Parse pickup point from WooCommerce order
    const pp = parsePickupPointData(order);
    if (pp) {
      setWooPickupPoint(pp);
      setTab("pickup_point");
    } else {
      setWooPickupPoint(null);
      // Auto-detect type from shipping method
      const method = order?.shipping_method || '';
      if (method.includes('נקודת') || method.includes('pickup') || method.includes('איסוף')) {
        setTab("pickup_point");
        // Auto-search pickup points when city is available
        if (cityName) {
          autoSearchPickupPoints(cityName, streetName);
        }
      } else if (method.includes('החזרה')) {
        setTab("pickup_drop");
      } else {
        setTab("standard");
      }
    }
  }, [open, order, client]);

  // Auto search function (called on mount for pickup orders)
  const autoSearchPickupPoints = async (searchCity, searchStreet) => {
    setSearchingPoints(true);
    setSelectedPoint(null);
    try {
      const { data } = await searchPickupPoints({ city: searchCity, street: searchStreet, num_points: 10 });
      if (data.success) {
        setPickupPoints(data.points);
      }
    } catch (e) {
      console.error("Auto search failed:", e);
    } finally {
      setSearchingPoints(false);
    }
  };

  const handleSearchPoints = async () => {
    if (!city) { toast.error("יש להזין עיר"); return; }
    setSearchingPoints(true);
    setSelectedPoint(null);
    try {
      const { data } = await searchPickupPoints({ city, street, num_points: 10 });
      if (data.success) {
        setPickupPoints(data.points);
        if (data.points.length === 0) toast.info("לא נמצאו נקודות איסוף");
      } else {
        toast.error(data.error || "שגיאה בחיפוש");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setSearchingPoints(false);
    }
  };

  const [printingLabel, setPrintingLabel] = useState(null); // null | 'thermal' | 'a4'

  const openPrintableLabel = async (trackingNum, format = 'thermal') => {
    // Open window IMMEDIATELY on click (before async) to avoid popup blocker
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(`<html dir="rtl"><head><title>שטר מטען - ${trackingNum}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Arial;font-size:20px;color:#555;}</style></head><body>⏳ טוען שטר מטען PDF...</body></html>`);
      newWindow.document.close();
    }

    setPrintingLabel(format);
    try {
      const { data } = await printShipmentLabel({ tracking_number: trackingNum, label_format: format });
      if (data.success && data.pdf_base64) {
        const dataUri = `data:application/pdf;base64,${data.pdf_base64}`;
        
        if (newWindow && !newWindow.closed) {
          newWindow.document.open();
          newWindow.document.write(`<html><head><title>שטר מטען ${format === 'a4' ? 'A4' : 'תרמי'} - ${trackingNum}</title><style>body{margin:0;overflow:hidden;}</style></head><body><iframe src="${dataUri}" style="border:none;position:absolute;top:0;left:0;width:100%;height:100%;"></iframe></body></html>`);
          newWindow.document.close();
        } else {
          const a = document.createElement('a');
          a.href = dataUri;
          a.download = `label-${format}-${trackingNum}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        toast.success(`שטר מטען ${format === 'a4' ? 'A4' : 'תרמי'} נפתח`);
      } else {
        if (newWindow && !newWindow.closed) newWindow.close();
        toast.error(data.error || "שגיאה בהורדת שטר מטען");
      }
    } catch (e) {
      if (newWindow && !newWindow.closed) newWindow.close();
      toast.error("שגיאה: " + e.message);
    } finally {
      setPrintingLabel(null);
    }
  };

  const handleCreate = async () => {
    if (!name || !phone || !city) {
      toast.error("יש למלא שם, טלפון ועיר");
      return;
    }
    
    const activePoint = wooPickupPoint || selectedPoint;
    if (tab === "pickup_point" && !activePoint) {
      toast.error("יש לבחור נקודת איסוף");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        shipment_type: tab,
        order_id: order?.id || null,
        external_order_number: order?.external_order_number || null,
        client_id: order?.client_id || client?.id || null,
        consignee_name: name,
        consignee_phone: phone,
        consignee_city: city,
        consignee_street: street,
        consignee_house: house,
        consignee_zip: zip,
        reference: order?.external_order_number || '',
        pickup_point_id: activePoint?.id || null,
        pickup_point_name: activePoint?.name || null,
        pickup_point_address: activePoint ? `${activePoint.street || ''}, ${activePoint.city || ''}` : null
      };

      const { data } = await createShipment(payload);

      if (data.success) {
        const trackingNum = data.tracking_number;
        setResult({ tracking: trackingNum, shipment_id: data.shipment_id });
        toast.success(`שטר מטען נוצר: ${trackingNum}`);
        onSuccess?.({ tracking_number: trackingNum });
        
        // Auto-open real PDF label in new tab
        openPrintableLabel(trackingNum, 'thermal');
      } else {
        toast.error(data.error || "שגיאה ביצירת המשלוח");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyTracking = () => {
    if (result?.tracking) {
      navigator.clipboard.writeText(result.tracking);
      toast.success("מספר מעקב הועתק");
    }
  };

  // Success screen
  if (result) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-md" dir="rtl">
          <div className="text-center py-6 space-y-4">
            <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
            <h2 className="text-xl font-bold text-green-800">שטר מטען נוצר בהצלחה!</h2>
            <div className="bg-green-50 rounded-xl p-4 space-y-2">
              <div className="text-sm text-gray-600">מספר מעקב:</div>
              <div className="text-2xl font-mono font-bold text-green-700 flex items-center justify-center gap-2">
                {result.tracking}
                <Button size="icon" variant="ghost" onClick={copyTracking}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button onClick={onClose}>סגור</Button>
              <Button variant="outline" onClick={() => openPrintableLabel(result.tracking, 'thermal')} disabled={printingLabel === 'thermal'}>
                {printingLabel === 'thermal' ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
                🖨️ תווית תרמית
              </Button>
              <Button variant="outline" onClick={() => openPrintableLabel(result.tracking, 'a4')} disabled={printingLabel === 'a4'}>
                {printingLabel === 'a4' ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
                📄 A4
              </Button>
              <Button variant="outline" asChild>
                <a href={`https://www.ups.co.il/tracking?trackingNumbers=${result.tracking}`} target="_blank" rel="noreferrer">
                  מעקב UPS
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5" />
            יצירת שטר מטען UPS
            {order && <Badge variant="outline">הזמנה #{order.external_order_number}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(val) => {
          setTab(val);
          // Auto-search when switching to pickup_point tab and no points loaded yet
          if (val === "pickup_point" && !wooPickupPoint && pickupPoints.length === 0 && city && !searchingPoints) {
            autoSearchPickupPoints(city, street);
          }
        }} dir="rtl">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="pickup_point" className="text-xs sm:text-sm">
              <MapPin className="w-4 h-4 ml-1" />
              נקודת איסוף
            </TabsTrigger>
            <TabsTrigger value="standard" className="text-xs sm:text-sm">
              <Truck className="w-4 h-4 ml-1" />
              משלוח
            </TabsTrigger>
            <TabsTrigger value="pickup_drop" className="text-xs sm:text-sm">
              <RotateCcw className="w-4 h-4 ml-1" />
              החזרה
            </TabsTrigger>
          </TabsList>

          {/* Address Fields */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="col-span-2 sm:col-span-1">
              <Label>שם מלא *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label>טלפון *</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} dir="ltr" className="text-right" />
            </div>
            <div>
              <Label>עיר *</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} />
            </div>
            <div>
              <Label>רחוב</Label>
              <Input value={street} onChange={e => setStreet(e.target.value)} />
            </div>
            <div>
              <Label>מספר בית</Label>
              <Input value={house} onChange={e => setHouse(e.target.value)} />
            </div>
            <div>
              <Label>מיקוד</Label>
              <Input value={zip} onChange={e => setZip(e.target.value)} dir="ltr" className="text-right" />
            </div>
          </div>

          {/* Pickup Point Tab */}
          <TabsContent value="pickup_point" className="space-y-3 mt-2">
            {wooPickupPoint ? (
              <Card className="border-green-300 bg-green-50">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-green-600 font-medium mb-1">נקודת איסוף מהזמנת הלקוח</div>
                      <div className="font-bold text-green-900 text-lg">{wooPickupPoint.name}</div>
                      <div className="text-sm text-green-800 mt-1">
                        {wooPickupPoint.street}, {wooPickupPoint.city}
                      </div>
                      {wooPickupPoint.hours && (
                        <div className="text-xs text-green-700 mt-1">{wooPickupPoint.hours}</div>
                      )}
                      <Badge variant="outline" className="mt-2 text-xs border-green-300 text-green-700">
                        {wooPickupPoint.type === 'store' ? '🏪 חנות' : '🔒 לוקר'} • {wooPickupPoint.id}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Selected point display */}
                {selectedPoint && (
                  <Card className="border-green-400 bg-green-50 ring-2 ring-green-200">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="text-xs text-green-600 font-medium mb-1">נקודת איסוף נבחרה ✓</div>
                          <div className="font-bold text-green-900 text-lg">{selectedPoint.name}</div>
                          <div className="text-sm text-green-800 mt-1">
                            {selectedPoint.street} {selectedPoint.house}, {selectedPoint.city}
                          </div>
                          {selectedPoint.hours && (
                            <div className="text-xs text-green-700 mt-1">{selectedPoint.hours}</div>
                          )}
                          <Badge variant="outline" className="mt-2 text-xs border-green-300 text-green-700">
                            {selectedPoint.type === 'store' ? '🏪 חנות' : '🔒 לוקר'} • {selectedPoint.id}
                          </Badge>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setSelectedPoint(null)}
                        >
                          שנה בחירה
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Search & results - only when no point selected */}
                {!selectedPoint && (
                  <>
                    <div className="flex gap-2">
                      <Button onClick={handleSearchPoints} disabled={searchingPoints || !city} className="bg-blue-600 hover:bg-blue-700">
                        {searchingPoints ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Search className="w-4 h-4 ml-1" />}
                        חפש נקודות קרובות
                      </Button>
                    </div>

                    {searchingPoints && (
                      <div className="text-center py-4">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                        <p className="text-sm text-gray-500">מחפש נקודות איסוף...</p>
                      </div>
                    )}
                    
                    {!searchingPoints && pickupPoints.length > 0 && (
                      <div className="space-y-2 max-h-[250px] overflow-y-auto">
                        <p className="text-xs text-gray-500 font-medium">לחץ על נקודה כדי לבחור:</p>
                        {pickupPoints.map(point => (
                          <Card 
                            key={point.id}
                            className="cursor-pointer transition-all hover:shadow-md hover:border-blue-400 border-gray-200"
                            onClick={() => setSelectedPoint(point)}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start gap-3">
                                <div className="mt-1">
                                  {point.type === 'store' ? <Store className="w-5 h-5 text-orange-500" /> : <Lock className="w-5 h-5 text-blue-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm">{point.name}</div>
                                  <div className="text-xs text-gray-500">{point.street} {point.house}, {point.city}</div>
                                  <div className="text-xs text-gray-400 mt-1">{point.hours}</div>
                                </div>
                                <Badge variant="outline" className="text-xs flex-shrink-0">{point.distance} ק"מ</Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}

                    {!searchingPoints && pickupPoints.length === 0 && !city && (
                      <p className="text-sm text-gray-400 text-center py-3">יש למלא עיר כדי לחפש נקודות איסוף</p>
                    )}
                  </>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="standard">
            <Card className="border-blue-100 bg-blue-50/50">
              <CardContent className="p-3 text-sm text-blue-800">
                <Truck className="w-4 h-4 inline ml-1" />
                משלוח רגיל לכתובת הנמען
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pickup_drop">
            <Card className="border-orange-100 bg-orange-50/50">
              <CardContent className="p-3 text-sm text-orange-800">
                <RotateCcw className="w-4 h-4 inline ml-1" />
                שטר מטען החזרה - הלקוח ישלח את החבילה חזרה
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-3 mt-4 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={loading}>ביטול</Button>
          <Button 
            onClick={handleCreate} 
            disabled={loading || (tab === "pickup_point" && !wooPickupPoint && !selectedPoint)} 
            className={`${
              (tab === "pickup_point" && (wooPickupPoint || selectedPoint)) || tab !== "pickup_point"
                ? 'bg-green-600 hover:bg-green-700 animate-pulse shadow-lg shadow-green-200'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Package className="w-4 h-4 ml-2" />}
            {loading ? "יוצר שטר מטען..." : "צור שטר מטען"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}