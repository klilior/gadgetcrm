import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Truck, Loader2, CheckCircle, Copy, Printer, RefreshCw } from "lucide-react";
import { cargoApi } from "@/functions/cargoApi";
import { toast } from "sonner";

const SHIPMENT_TYPES = [
  { value: "delivery", label: "🚚 משלוח רגיל", desc: "שליחה ללקוח", color: "bg-blue-100 text-blue-800 border-blue-300" },
  { value: "return", label: "📦 החזרה", desc: "איסוף מהלקוח", color: "bg-orange-100 text-orange-800 border-orange-300" },
  { value: "exchange", label: "🔄 החלפה", desc: "שליחה + איסוף", color: "bg-purple-100 text-purple-800 border-purple-300" },
];

export default function CargoShipmentForm({ initialCustomer }) {
  const [shipmentType, setShipmentType] = useState("delivery");
  const [toName, setToName] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [toStreet, setToStreet] = useState("");
  const [toCity, setToCity] = useState("");
  const [toFloor, setToFloor] = useState("");
  const [toApartment, setToApartment] = useState("");
  const [toEntrance, setToEntrance] = useState("");
  const [notes, setNotes] = useState("");
  const [numParcels, setNumParcels] = useState(1);
  const [showCOD, setShowCOD] = useState(false);
  const [codAmount, setCodAmount] = useState(0);
  const [reference, setReference] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [statusResult, setStatusResult] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  useEffect(() => {
    if (!initialCustomer) return;
    setToName(initialCustomer.name || "");
    setToPhone(initialCustomer.phone || "");
    setToCity(initialCustomer.city || "");
    setToStreet(initialCustomer.address || [initialCustomer.street, initialCustomer.house].filter(Boolean).join(" ") || "");
    setToFloor(initialCustomer.floor || "");
    setToApartment(initialCustomer.apartment || "");
    setToEntrance(initialCustomer.entrance || "");
    setReference(initialCustomer.reference || "");
  }, [initialCustomer]);

  const handleSubmit = async () => {
    if (!toName || !toPhone || !toCity) { toast.error("נא למלא שם, טלפון ועיר"); return; }
    setIsSubmitting(true);
    try {
      const res = await cargoApi({
        action: "create_shipment", shipment_type: shipmentType,
        to_name: toName, to_phone: toPhone, to_street: toStreet, to_city: toCity,
        to_floor: toFloor, to_apartment: toApartment, to_entrance: toEntrance,
        notes, number_of_parcels: numParcels,
        cash_on_delivery: showCOD ? codAmount : 0,
        order_number: reference,
      });
      const data = res.data || res;
      if (data.success) {
        setResult(data);
        toast.success(`משלוח קארגו נוצר! #${data.shipment_id}`);
      } else toast.error(data.error || "שגיאה");
    } catch (e) { toast.error(e.message); }
    setIsSubmitting(false);
  };

  const handlePrintLabel = async () => {
    if (!result?.shipment_id) return;
    setPrintingLabel(true);
    try {
      const res = await cargoApi({ action: "print_label", shipment_id: result.shipment_id });
      const data = res.data || res;
      if (data.label_url) { window.open(data.label_url, "_blank"); toast.success("תווית נפתחה"); }
      else if (data.label_base64) {
        const byteChars = atob(data.label_base64);
        const arr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) arr[i] = byteChars.charCodeAt(i);
        window.open(URL.createObjectURL(new Blob([arr], { type: "application/pdf" })), "_blank");
        toast.success("תווית נפתחה");
      } else toast.error("לא התקבלה תווית");
    } catch (e) { toast.error("שגיאה: " + e.message); }
    setPrintingLabel(false);
  };

  const handleCheckStatus = async () => {
    if (!result?.shipment_id) return;
    setCheckingStatus(true);
    try {
      const res = await cargoApi({ action: "get_status", shipment_id: result.shipment_id });
      setStatusResult(res.data || res);
    } catch (e) { toast.error("שגיאה: " + e.message); }
    setCheckingStatus(false);
  };

  const resetForm = () => {
    setResult(null); setStatusResult(null);
    setToName(""); setToPhone(""); setToStreet(""); setToCity("");
    setToFloor(""); setToApartment(""); setToEntrance("");
    setNotes(""); setNumParcels(1); setReference("");
    setShowCOD(false); setCodAmount(0);
  };

  if (result) {
    return (
      <Card className="border-0 shadow-lg rounded-2xl mt-4">
        <CardContent className="py-8 text-center space-y-4">
          <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
          <h2 className="text-xl font-bold text-green-800">משלוח קארגו נוצר בהצלחה!</h2>
          <div className="bg-green-50 rounded-xl p-4">
            <div className="text-sm text-gray-600">מספר מעקב:</div>
            <div className="text-2xl font-mono font-bold text-green-700 flex items-center justify-center gap-2">
              {result.shipment_id}
              <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(result.shipment_id); toast.success("הועתק"); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            <Button onClick={handlePrintLabel} disabled={printingLabel} className="bg-blue-600 hover:bg-blue-700 text-white">
              {printingLabel ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
              הדפס תווית
            </Button>
            <Button onClick={handleCheckStatus} disabled={checkingStatus} variant="outline">
              {checkingStatus ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RefreshCw className="w-4 h-4 ml-1" />}
              בדוק סטטוס
            </Button>
          </div>
          {statusResult && (
            <div className="bg-gray-50 border rounded-xl p-3 text-sm">
              <p className="font-medium">סטטוס: <span className="text-blue-700">{statusResult.status_text || "לא ידוע"}</span></p>
            </div>
          )}
          <Button onClick={resetForm}>משלוח חדש</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-lg rounded-2xl mt-4">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Truck className="w-5 h-5 text-blue-600" />
          משלוח קארגו
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Shipment Type */}
        <div className="grid grid-cols-3 gap-2">
          {SHIPMENT_TYPES.map(t => (
            <button key={t.value} onClick={() => setShipmentType(t.value)}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                shipmentType === t.value ? t.color + " border-current shadow-md" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}>
              <div className="text-lg">{t.label.split(" ")[0]}</div>
              <div className="text-xs font-medium mt-1">{t.label.split(" ").slice(1).join(" ")}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{t.desc}</div>
            </button>
          ))}
        </div>

        {/* Address */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>שם הנמען *</Label>
            <Input value={toName} onChange={e => setToName(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>טלפון *</Label>
            <Input value={toPhone} onChange={e => setToPhone(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>רחוב + מספר</Label>
            <Input value={toStreet} onChange={e => setToStreet(e.target.value)} />
          </div>
          <div><Label>עיר *</Label><Input value={toCity} onChange={e => setToCity(e.target.value)} /></div>
          <div><Label>קומה</Label><Input value={toFloor} onChange={e => setToFloor(e.target.value)} /></div>
          <div><Label>דירה</Label><Input value={toApartment} onChange={e => setToApartment(e.target.value)} /></div>
          <div><Label>כניסה</Label><Input value={toEntrance} onChange={e => setToEntrance(e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><Label>הערות</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <div><Label>הפניה</Label><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="מס׳ הזמנה" /></div>
          <div><Label>מספר חבילות</Label><Input type="number" min={1} value={numParcels} onChange={e => setNumParcels(parseInt(e.target.value) || 1)} /></div>
          <div className="flex items-end">
            <Button variant={showCOD ? "default" : "outline"} size="sm" className="h-9 rounded-xl" onClick={() => setShowCOD(!showCOD)}>
              {showCOD ? "✅" : "💰"} גבייה במזומן
            </Button>
          </div>
        </div>

        {showCOD && (
          <div><Label>סכום לגבייה (₪)</Label><Input type="number" min={0} value={codAmount} onChange={e => setCodAmount(parseFloat(e.target.value) || 0)} /></div>
        )}

        <Button onClick={handleSubmit} disabled={isSubmitting}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 text-base rounded-xl shadow-lg">
          {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin ml-2" /> : <Truck className="w-5 h-5 ml-2" />}
          {isSubmitting ? "יוצר משלוח..." : `צור משלוח קארגו — ${SHIPMENT_TYPES.find(t => t.value === shipmentType)?.label.split(" ").slice(1).join(" ")}`}
        </Button>
      </CardContent>
    </Card>
  );
}