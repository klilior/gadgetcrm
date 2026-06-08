import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MapPin, Truck, RotateCcw, Loader2, CheckCircle, Copy, Printer, Search, Store, Lock, AlertTriangle } from "lucide-react";
import { createShipment } from "@/functions/createShipment";
import { searchPickupPoints } from "@/functions/searchPickupPoints";
import { printShipmentLabel } from "@/functions/printShipmentLabel";
import { toast } from "sonner";
import { getPickupPointSafety } from "./pickupPointSafety";

export default function UPSShipmentForm({ initialCustomer }) {
  const [tab, setTab] = useState("standard");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [printingLabel, setPrintingLabel] = useState(null);

  // Form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [house, setHouse] = useState("");
  const [zip, setZip] = useState("");
  const [reference, setReference] = useState("");

  // Pickup points
  const [pickupPoints, setPickupPoints] = useState([]);
  const [searchingPoints, setSearchingPoints] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);

  useEffect(() => {
    if (!initialCustomer) return;
    setName(initialCustomer.name || "");
    setPhone(initialCustomer.phone || "");
    setCity(initialCustomer.city || "");
    setStreet(initialCustomer.address || "");
  }, [initialCustomer]);

  const handleSearchPoints = async () => {
    if (!city) { toast.error("יש להזין עיר"); return; }
    setSearchingPoints(true);
    setSelectedPoint(null);
    try {
      const res = await searchPickupPoints({ city, street: street || "", num_points: 10 });
      const data = res?.data || res;
      if (data?.success && Array.isArray(data.points)) {
        setPickupPoints(data.points);
        if (data.points.length === 0) toast.info("לא נמצאו נקודות איסוף");
      } else toast.error(data?.error || "שגיאה בחיפוש");
    } catch (e) { toast.error("שגיאה: " + e.message); }
    setSearchingPoints(false);
  };

  const handleCreate = async () => {
    if (!name || !phone || !city) { toast.error("יש למלא שם, טלפון ועיר"); return; }
    if (tab === "pickup_point" && !selectedPoint) { toast.error("יש לבחור נקודת איסוף"); return; }
    if (tab === "pickup_point") {
      const safety = getPickupPointSafety(selectedPoint, city);
      if (!safety.allowed) {
        const approved = window.confirm(`שים לב: נקודת האיסוף דורשת בדיקה:\n${safety.reasons.join('\n')}\n\nהאם לאשר וליצור שטר מטען בכל זאת?`);
        if (!approved) return;
      }
    }
    setLoading(true);
    try {
      const { data } = await createShipment({
        shipment_type: tab,
        consignee_name: name, consignee_phone: phone,
        consignee_city: city, consignee_street: street, consignee_house: house, consignee_zip: zip,
        reference,
        pickup_point_id: selectedPoint?.id || null,
        pickup_point_name: selectedPoint?.name || null,
        pickup_point_address: selectedPoint ? `${selectedPoint.street || ""}, ${selectedPoint.city || ""}` : null,
        pickup_point_city: selectedPoint?.city || null,
        pickup_point_distance: selectedPoint?.distance ?? null,
      });
      if (data.success) {
        setResult({ tracking: data.tracking_number, shipment_id: data.shipment_id });
        toast.success(`שטר מטען נוצר: ${data.tracking_number}`);
      } else toast.error(data.error || "שגיאה ביצירת המשלוח");
    } catch (e) { toast.error("שגיאה: " + e.message); }
    setLoading(false);
  };

  const openLabel = async (trackingNum, format) => {
    setPrintingLabel(format);
    try {
      const { data } = await printShipmentLabel({ tracking_number: trackingNum, label_format: format });
      if (data.success && data.pdf_base64) {
        const byteChars = atob(data.pdf_base64);
        const arr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) arr[i] = byteChars.charCodeAt(i);
        const blob = new Blob([arr], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        toast.success("שטר מטען נפתח");
      } else toast.error(data.error || "שגיאה בהורדת שטר מטען");
    } catch (e) { toast.error("שגיאה: " + e.message); }
    setPrintingLabel(null);
  };

  const resetForm = () => {
    setResult(null);
    setName(""); setPhone(""); setCity(""); setStreet(""); setHouse(""); setZip(""); setReference("");
    setSelectedPoint(null); setPickupPoints([]);
  };

  if (result) {
    return (
      <Card className="border-0 shadow-lg rounded-2xl mt-4">
        <CardContent className="py-8 text-center space-y-4">
          <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
          <h2 className="text-xl font-bold text-green-800">שטר מטען UPS נוצר בהצלחה!</h2>
          <div className="bg-green-50 rounded-xl p-4">
            <div className="text-sm text-gray-600">מספר מעקב:</div>
            <div className="text-2xl font-mono font-bold text-green-700 flex items-center justify-center gap-2">
              {result.tracking}
              <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(result.tracking); toast.success("הועתק"); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            <Button variant="outline" onClick={() => openLabel(result.tracking, "a4")} disabled={printingLabel === "a4"}>
              {printingLabel === "a4" ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
              📄 הדפס A4
            </Button>
            <Button variant="outline" onClick={() => openLabel(result.tracking, "thermal")} disabled={printingLabel === "thermal"}>
              {printingLabel === "thermal" ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
              🖨️ תווית תרמית
            </Button>
            <Button variant="outline" asChild>
              <a href={`https://www.ups.co.il/tracking?trackingNumbers=${result.tracking}`} target="_blank" rel="noreferrer">מעקב UPS</a>
            </Button>
          </div>
          <Button onClick={resetForm} className="mt-4">משלוח חדש</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-lg rounded-2xl mt-4">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Truck className="w-5 h-5 text-purple-600" />
          משלוח UPS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={setTab} dir="rtl">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="pickup_point"><MapPin className="w-4 h-4 ml-1" />נקודת איסוף</TabsTrigger>
            <TabsTrigger value="standard"><Truck className="w-4 h-4 ml-1" />עד הבית</TabsTrigger>
            <TabsTrigger value="pickup_drop"><RotateCcw className="w-4 h-4 ml-1" />החזרה</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 gap-3">
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
          <div className="col-span-2">
            <Label>הפניה / מס׳ הזמנה</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="אופציונלי" />
          </div>
        </div>

        {/* Pickup Points */}
        {tab === "pickup_point" && (
          <div className="space-y-3">
            {selectedPoint ? (
              <Card className="border-green-400 bg-green-50 ring-2 ring-green-200">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-green-600 font-medium mb-1">נקודה נבחרה ✓</div>
                      <div className="font-bold text-green-900">{selectedPoint.name}</div>
                      <div className="text-sm text-green-800 mt-1">{selectedPoint.street} {selectedPoint.house}, {selectedPoint.city}</div>
                      <Badge variant="outline" className="mt-2 text-xs border-green-300 text-green-700">
                        {selectedPoint.type === "store" ? "🏪 חנות" : "🔒 לוקר"} • {selectedPoint.id}
                      </Badge>
                      {(() => {
                        const safety = getPickupPointSafety(selectedPoint, city);
                        if (safety.allowed) return null;
                        return (
                          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 flex gap-2">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            <span>דורש בדיקת נציג ואישור: {safety.reasons.join(' · ')}</span>
                          </div>
                        );
                      })()}
                    </div>
                    <Button variant="ghost" size="sm" className="text-red-500" onClick={() => setSelectedPoint(null)}>שנה</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <Button onClick={handleSearchPoints} disabled={searchingPoints || !city} className="bg-blue-600 hover:bg-blue-700">
                  {searchingPoints ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Search className="w-4 h-4 ml-1" />}
                  חפש נקודות קרובות
                </Button>
                {pickupPoints.length > 0 && (
                  <div className="space-y-2 max-h-[250px] overflow-y-auto">
                    {pickupPoints.map(point => {
                      const safety = getPickupPointSafety(point, city);
                      return (
                        <Card key={point.id} className={safety.allowed ? "cursor-pointer hover:shadow-md hover:border-blue-400" : "cursor-pointer bg-amber-50 border-amber-300 hover:shadow-md hover:border-amber-400"} onClick={() => setSelectedPoint(point)}>
                          <CardContent className="p-3 flex items-start gap-3">
                            {point.type === "store" ? <Store className="w-5 h-5 text-orange-500 mt-1" /> : <Lock className="w-5 h-5 text-blue-500 mt-1" />}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm">{point.name}</div>
                              <div className="text-xs text-gray-500">{point.street} {point.house}, {point.city}</div>
                              {!safety.allowed && (
                                <div className="mt-2 text-xs text-amber-800 flex gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>דורש בדיקת נציג ואישור: {safety.reasons.join(' · ')}</span>
                                </div>
                              )}
                            </div>
                            <Badge variant="outline" className="text-xs flex-shrink-0">{point.distance} ק"מ</Badge>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === "standard" && (
          <Card className="border-blue-100 bg-blue-50/50">
            <CardContent className="p-3 text-sm text-blue-800">
              <Truck className="w-4 h-4 inline ml-1" /> משלוח רגיל UPS לכתובת הנמען
            </CardContent>
          </Card>
        )}

        {tab === "pickup_drop" && (
          <Card className="border-orange-100 bg-orange-50/50">
            <CardContent className="p-3 text-sm text-orange-800">
              <RotateCcw className="w-4 h-4 inline ml-1" /> שטר מטען החזרה — הלקוח ישלח חזרה
            </CardContent>
          </Card>
        )}

        <Button
          onClick={handleCreate}
          disabled={loading || (tab === "pickup_point" && !selectedPoint)}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white h-12 text-base rounded-xl shadow-lg"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin ml-2" /> : <Truck className="w-5 h-5 ml-2" />}
          {loading ? "יוצר שטר מטען..." : "צור שטר מטען UPS"}
        </Button>
      </CardContent>
    </Card>
  );
}