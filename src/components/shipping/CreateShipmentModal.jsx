import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, MapPin, Truck, RotateCcw, Package, CheckCircle, Copy, Search, Store, Lock } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { createShipment } from "@/functions/createShipment";
import { searchPickupPoints } from "@/functions/searchPickupPoints";
import { toast } from "sonner";

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
  const [wooPickupPointId, setWooPickupPointId] = useState(null);
  const [wooPickupPointName, setWooPickupPointName] = useState(null);

  // Pre-fill from order/client
  useEffect(() => {
    if (!open) {
      setResult(null);
      setSelectedPoint(null);
      setPickupPoints([]);
      return;
    }

    let billing = {};
    try { billing = JSON.parse(order?.raw_data_billing || '{}'); } catch {}

    const fullName = client?.full_name || `${billing.first_name || ''} ${billing.last_name || ''}`.trim();
    const phoneNum = client?.phone || billing.phone || '';
    const cityName = billing.city || client?.city || '';
    const streetName = billing.address_1 || '';
    const houseNum = '';
    const zipCode = billing.postcode || '';

    setName(fullName);
    setPhone(phoneNum);
    setCity(cityName);
    setStreet(streetName);
    setHouse(houseNum);
    setZip(zipCode);

    // Check if WooCommerce order has pickup point info
    const shippingMethod = order?.shipping_method || '';
    const isPickup = shippingMethod.includes('נקודת') || shippingMethod.includes('pickup') || shippingMethod.includes('איסוף');
    const isReturn = shippingMethod.includes('החזרה');

    if (isReturn) {
      setTab("pickup_drop");
    } else if (isPickup) {
      setTab("pickup_point");
      // Try to extract pickup point from order meta/note
      extractWooPickupPoint(order);
    } else {
      setTab("standard");
    }
  }, [open, order, client]);

  const extractWooPickupPoint = (order) => {
    // WooCommerce stores pickup point as JSON in customer_note or meta
    try {
      const note = order?.customer_note || '';
      // Look for patterns like "נקודת איסוף: שם הנקודה" or JSON
      const match = note.match(/iid["\s:]+([A-Z0-9]+)/i);
      if (match) {
        setWooPickupPointId(match[1]);
      }
      // Check raw_data_billing for pickup info
      const billing = JSON.parse(order?.raw_data_billing || '{}');
      if (billing._ups_pickup_point) {
        const pp = typeof billing._ups_pickup_point === 'string' 
          ? JSON.parse(billing._ups_pickup_point) 
          : billing._ups_pickup_point;
        if (pp.iid) {
          setWooPickupPointId(pp.iid);
          setWooPickupPointName(pp.name || pp.PointName);
        }
      }
    } catch {}
  };

  const handleSearchPoints = async () => {
    if (!city) {
      toast.error("יש להזין עיר");
      return;
    }
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

  const handleCreate = async () => {
    if (!name || !phone || !city) {
      toast.error("יש למלא שם, טלפון ועיר");
      return;
    }
    if (tab === "pickup_point" && !selectedPoint && !wooPickupPointId) {
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
        pickup_point_id: selectedPoint?.id || wooPickupPointId || null,
        pickup_point_name: selectedPoint?.name || wooPickupPointName || null,
        pickup_point_address: selectedPoint ? `${selectedPoint.street} ${selectedPoint.house}, ${selectedPoint.city}` : null
      };

      const { data } = await createShipment(payload);

      if (data.success) {
        setResult({ tracking: data.tracking_number, shipment_id: data.shipment_id });
        toast.success(`שטר מטען נוצר: ${data.tracking_number}`);
        onSuccess?.();
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
            <div className="flex gap-3 justify-center">
              <Button onClick={onClose}>סגור</Button>
              <Button variant="outline" asChild>
                <a 
                  href={`https://www.ups.co.il/tracking?trackingNumbers=${result.tracking}`} 
                  target="_blank" 
                  rel="noreferrer"
                >
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

        <Tabs value={tab} onValueChange={setTab} dir="rtl">
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

          {/* Address Fields - shared across all tabs */}
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

          {/* Pickup Point Tab Content */}
          <TabsContent value="pickup_point" className="space-y-3 mt-2">
            {wooPickupPointId ? (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <div>
                      <div className="font-medium text-green-800">נקודת איסוף מהזמנה</div>
                      <div className="text-sm text-green-700">
                        {wooPickupPointName || wooPickupPointId}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button 
                    onClick={handleSearchPoints} 
                    disabled={searchingPoints || !city}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {searchingPoints ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Search className="w-4 h-4 ml-1" />}
                    חפש נקודות קרובות
                  </Button>
                </div>
                
                {pickupPoints.length > 0 && (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto">
                    {pickupPoints.map(point => (
                      <Card 
                        key={point.id}
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          selectedPoint?.id === point.id 
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' 
                            : 'border-gray-200'
                        }`}
                        onClick={() => setSelectedPoint(point)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-1">
                              {point.type === 'store' 
                                ? <Store className="w-5 h-5 text-orange-500" />
                                : <Lock className="w-5 h-5 text-blue-500" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm">{point.name}</div>
                              <div className="text-xs text-gray-500">
                                {point.street} {point.house}, {point.city}
                              </div>
                              <div className="text-xs text-gray-400 mt-1">{point.hours}</div>
                            </div>
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {point.distance} ק"מ
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
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
          <Button variant="outline" onClick={onClose} disabled={loading}>
            ביטול
          </Button>
          <Button 
            onClick={handleCreate} 
            disabled={loading}
            className="bg-green-600 hover:bg-green-700"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin ml-2" />
            ) : (
              <Package className="w-4 h-4 ml-2" />
            )}
            {loading ? "יוצר שטר מטען..." : "צור שטר מטען"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}