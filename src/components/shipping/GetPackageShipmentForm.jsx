import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Loader2, CheckCircle, Copy, DollarSign, Printer } from "lucide-react";
import { getPackageApi } from "@/functions/getPackageApi";
import { toast } from "sonner";
import GetPackageLabel from "./GetPackageLabel";

export default function GetPackageShipmentForm({ initialCustomer }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [dropoffNotes, setDropoffNotes] = useState("");
  const [packageSize, setPackageSize] = useState("SMALL");
  const [reference, setReference] = useState("");
  
  const [step, setStep] = useState("form"); // form | quote | accepted
  const [loading, setLoading] = useState(false);
  const [quoteData, setQuoteData] = useState(null);
  const [shipmentId, setShipmentId] = useState(null);
  const [acceptedShipment, setAcceptedShipment] = useState(null);
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    if (!initialCustomer) return;
    setName(initialCustomer.name || "");
    setPhone(initialCustomer.phone || "");
    setCity(initialCustomer.city || "");
    setAddress(initialCustomer.address || [initialCustomer.street, initialCustomer.house].filter(Boolean).join(" ") || "");
    setDropoffNotes(initialCustomer.notes || [initialCustomer.floor ? `קומה ${initialCustomer.floor}` : "", initialCustomer.apartment ? `דירה ${initialCustomer.apartment}` : "", initialCustomer.entrance ? `כניסה ${initialCustomer.entrance}` : ""].filter(Boolean).join(", "));
    setReference(initialCustomer.reference || "");
  }, [initialCustomer]);

  const handleGetQuote = async () => {
    if (!name || !phone || !city || !address) { toast.error("נא למלא שם, טלפון, עיר וכתובת"); return; }
    setLoading(true);
    try {
      const orderId = reference || `manual_${Date.now()}`;
      const { data } = await getPackageApi({
        action: "createQuote",
        order_id: orderId,
        customer_name: name, customer_phone: phone,
        dropoff_name: name, dropoff_phone: phone,
        dropoff_address: address, dropoff_city: city,
        dropoff_notes: dropoffNotes, package_size: packageSize,
        package_quantity: 1,
      });
      if (data.success) {
        setQuoteData(data.shipment || data.quote);
        setShipmentId(data.shipment?.id);
        setStep("quote");
        toast.success(`הצעת מחיר: ₪${data.shipment?.quote_price || "?"}`);
      } else toast.error(data.error || "שגיאה בקבלת הצעת מחיר");
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const handleAccept = async () => {
    if (!shipmentId) return;
    setLoading(true);
    try {
      const { data } = await getPackageApi({ action: "acceptQuote", shipment_id: shipmentId });
      if (data.success) {
        // Load full shipment data
        const { data: listData } = await getPackageApi({ action: "getShipmentsForOrder", order_id: quoteData?.order_id || reference || `manual_${Date.now()}` });
        const latest = listData.shipments?.[0];
        setAcceptedShipment(latest || quoteData);
        setStep("accepted");
        toast.success("המשלוח אושר בהצלחה!");
      } else toast.error(data.error || "שגיאה באישור");
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const resetForm = () => {
    setStep("form"); setQuoteData(null); setShipmentId(null); setAcceptedShipment(null);
    setName(""); setPhone(""); setCity(""); setAddress(""); setDropoffNotes(""); setReference("");
  };

  // Accepted screen
  if (step === "accepted") {
    const shipment = acceptedShipment || quoteData;
    const deliveryId = shipment?.delivery_id || "";
    return (
      <Card className="border-0 shadow-lg rounded-2xl mt-4">
        <CardContent className="py-8 text-center space-y-4">
          <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
          <h2 className="text-xl font-bold text-green-800">משלוח GetPackage אושר!</h2>
          <div className="bg-green-50 rounded-xl p-4">
            <div className="text-sm text-gray-600">מזהה משלוח:</div>
            <div className="text-2xl font-mono font-bold text-green-700 flex items-center justify-center gap-2">
              {deliveryId}
              <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(deliveryId); toast.success("הועתק"); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {shipment?.tracking_url && (
            <Button variant="outline" asChild>
              <a href={shipment.tracking_url} target="_blank" rel="noreferrer">🔗 מעקב משלוח</a>
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowLabel(true)}>
            <Printer className="w-4 h-4 ml-1" />
            הדפס תעודת משלוח
          </Button>
          <Button onClick={resetForm}>משלוח חדש</Button>

          {showLabel && shipment && (
            <GetPackageLabel
              shipment={shipment}
              open={showLabel}
              onClose={() => setShowLabel(false)}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  // Quote received screen
  if (step === "quote") {
    return (
      <Card className="border-0 shadow-lg rounded-2xl mt-4">
        <CardContent className="py-8 text-center space-y-4">
          <DollarSign className="w-16 h-16 mx-auto text-blue-500" />
          <h2 className="text-xl font-bold text-blue-800">הצעת מחיר התקבלה!</h2>
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="text-3xl font-bold text-blue-700">
              ₪{quoteData?.quote_price || "?"}
            </div>
            <div className="text-sm text-gray-500 mt-1">{quoteData?.quote_currency || "ILS"}</div>
          </div>
          <div className="text-sm text-gray-600">
            <p><strong>נמען:</strong> {name}</p>
            <p><strong>כתובת:</strong> {address}, {city}</p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={handleAccept} disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white px-8">
              {loading ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <CheckCircle className="w-4 h-4 ml-1" />}
              אשר משלוח
            </Button>
            <Button variant="outline" onClick={() => setStep("form")} disabled={loading}>חזור</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Form
  return (
    <Card className="border-0 shadow-lg rounded-2xl mt-4">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Truck className="w-5 h-5 text-emerald-600" />
          משלוח GetPackage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <Label>שם נמען *</Label>
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
            <Label>כתובת (רחוב + מספר) *</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div>
            <Label>הערות למשלוח</Label>
            <Input value={dropoffNotes} onChange={e => setDropoffNotes(e.target.value)} placeholder="קומה, דירה..." />
          </div>
          <div>
            <Label>גודל חבילה</Label>
            <Select value={packageSize} onValueChange={setPackageSize}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ENVELOPE">מעטפה</SelectItem>
                <SelectItem value="SMALL">קטן</SelectItem>
                <SelectItem value="MEDIUM">בינוני</SelectItem>
                <SelectItem value="LARGE">גדול</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>הפניה / מס׳ הזמנה</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="אופציונלי" />
          </div>
        </div>

        <Button onClick={handleGetQuote} disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-12 text-base rounded-xl shadow-lg">
          {loading ? <Loader2 className="w-5 h-5 animate-spin ml-2" /> : <DollarSign className="w-5 h-5 ml-2" />}
          {loading ? "מקבל הצעת מחיר..." : "קבל הצעת מחיר"}
        </Button>
      </CardContent>
    </Card>
  );
}