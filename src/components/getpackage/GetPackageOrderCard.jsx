import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Truck, DollarSign, RefreshCw, Send, XCircle, CheckCircle, Loader2, ExternalLink, Package, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getPackageApi } from "@/functions/getPackageApi";

const STATUS_MAP = {
  draft: { label: "טיוטה", color: "bg-gray-100 text-gray-700" },
  quote_received: { label: "הצעת מחיר", color: "bg-blue-100 text-blue-700" },
  quote_failed: { label: "הצעה נכשלה", color: "bg-red-100 text-red-700" },
  accepted: { label: "אושר", color: "bg-green-100 text-green-700" },
  pickup_pending: { label: "ממתין לאיסוף", color: "bg-yellow-100 text-yellow-700" },
  picked_up: { label: "נאסף", color: "bg-purple-100 text-purple-700" },
  in_transit: { label: "בדרך", color: "bg-indigo-100 text-indigo-700" },
  delivered: { label: "נמסר", color: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "בוטל", color: "bg-gray-100 text-gray-500" },
  failed: { label: "נכשל", color: "bg-red-100 text-red-700" },
};

export default function GetPackageOrderCard({ order, isManager, isShiftManager, onAddNote }) {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [packageSize, setPackageSize] = useState("MEDIUM");
  const [dropoffNotes, setDropoffNotes] = useState(order.notes || "");

  const orderId = order.id || order.order_number || order.external_order_number;

  useEffect(() => {
    loadShipments();
  }, [orderId]);

  const loadShipments = async () => {
    setLoading(true);
    try {
      const { data } = await getPackageApi({ action: "getShipmentsForOrder", order_id: orderId });
      setShipments(data.shipments || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const activeShipment = shipments.find(s =>
    ["quote_received", "accepted", "pickup_pending", "picked_up", "in_transit"].includes(s.status)
  );
  const latestShipment = shipments[0];

  const handleGetQuote = async () => {
    if (activeShipment) {
      toast.error("כבר קיים משלוח GetPackage פעיל להזמנה זו.");
      return;
    }
    const phone = order.customer_phone;
    const city = order.shipping_city || order.dropoff_city;
    const address = order.shipping_street || order.shipping_address_full || order.dropoff_address;

    if (!phone) { toast.error("חסר מספר טלפון ללקוח."); return; }
    if (!city) { toast.error("חסרה עיר למשלוח."); return; }
    if (!address) { toast.error("חסרה כתובת למשלוח."); return; }

    setActionLoading("quote");
    try {
      const { data } = await getPackageApi({
        action: "createQuote",
        order_id: orderId,
        woo_order_id: order.external_order_number || "",
        customer_name: order.customer_name || "",
        customer_phone: phone,
        customer_email: order.customer_email || "",
        dropoff_name: order.customer_name || "",
        dropoff_phone: phone,
        dropoff_address: address,
        dropoff_city: city,
        dropoff_notes: dropoffNotes,
        package_description: (order.products || []).map(p => p.name).join(", ").substring(0, 200),
        package_quantity: (order.products || []).reduce((s, p) => s + (p.quantity || 1), 0),
        package_size: packageSize,
      });

      if (data.success) {
        toast.success(`הצעת מחיר התקבלה: ₪${data.shipment?.quote_price || "?"}`);
        loadShipments();
      } else {
        toast.error(data.error || "שגיאה בקבלת הצעת מחיר");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    }
    setActionLoading(null);
    setShowForm(false);
  };

  const handleAcceptQuote = async (shipment) => {
    setActionLoading("accept");
    try {
      const { data } = await getPackageApi({ action: "acceptQuote", shipment_id: shipment.id });
      if (data.success) {
        toast.success("המשלוח אושר בהצלחה!");
        if (onAddNote) {
          onAddNote(`נוצר משלוח GetPackage.\nמזהה משלוח: ${data.delivery_id}\nמזהה מסלול: ${data.route_id}`);
        }
        loadShipments();
      } else {
        toast.error(data.error || "שגיאה באישור המשלוח");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    }
    setActionLoading(null);
  };

  const handleRefreshStatus = async (shipment) => {
    setActionLoading("refresh");
    try {
      const { data } = await getPackageApi({ action: "refreshStatus", shipment_id: shipment.id });
      if (data.success) {
        toast.success(`סטטוס עודכן: ${STATUS_MAP[data.status]?.label || data.status}`);
        loadShipments();
      } else {
        toast.error(data.error || "שגיאה ברענון סטטוס");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    }
    setActionLoading(null);
  };

  const handleSendTracking = async (shipment) => {
    setActionLoading("sms");
    try {
      const { data } = await getPackageApi({ action: "sendTrackingSms", shipment_id: shipment.id });
      if (data.success) {
        toast.success(data.message || "SMS נשלח");
      } else {
        toast.error(data.error || "שגיאה בשליחת SMS");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    }
    setActionLoading(null);
  };

  const handleCancelShipment = async (shipment) => {
    if (!window.confirm("האם אתה בטוח שברצונך לבטל את המשלוח?")) return;
    setActionLoading("cancel");
    try {
      const { data } = await getPackageApi({ action: "cancelShipment", shipment_id: shipment.id });
      if (data.success) {
        toast.success(data.message || "המשלוח בוטל");
        if (onAddNote) onAddNote("משלוח GetPackage בוטל.");
        loadShipments();
      } else {
        toast.error(data.error || "שגיאה בביטול המשלוח");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <Card className="border-emerald-200">
        <CardContent className="py-4 text-center text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" /> טוען GetPackage...
        </CardContent>
      </Card>
    );
  }

  const shipment = activeShipment || latestShipment;
  const statusInfo = shipment ? STATUS_MAP[shipment.status] || { label: shipment.status, color: "bg-gray-100" } : null;

  return (
    <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-emerald-700 flex items-center gap-2">
          <Truck className="w-4 h-4" />
          משלוח GetPackage
          {shipment && <Badge className={`${statusInfo.color} text-[10px] mr-auto`}>{statusInfo.label}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Active/Latest shipment info */}
        {shipment && shipment.status !== "draft" && (
          <div className="text-xs space-y-1 bg-white/80 rounded-lg p-3 border border-emerald-100">
            {shipment.quote_price > 0 && (
              <div className="flex items-center gap-1 font-semibold text-emerald-700">
                <DollarSign className="w-3 h-3" />
                מחיר: ₪{shipment.quote_price} {shipment.quote_currency !== "ILS" ? shipment.quote_currency : ""}
              </div>
            )}
            {shipment.delivery_id && (
              <div className="text-gray-600">מזהה משלוח: <span className="font-mono">{shipment.delivery_id}</span></div>
            )}
            {shipment.courier_name && (
              <div className="text-gray-600">שליח: {shipment.courier_name} {shipment.courier_phone ? `(${shipment.courier_phone})` : ""}</div>
            )}
            {shipment.tracking_url && (
              <a href={shipment.tracking_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 underline">
                <ExternalLink className="w-3 h-3" /> מעקב משלוח
              </a>
            )}
            {shipment.last_error && (
              <div className="flex items-start gap-1 text-red-600 mt-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{shipment.last_error}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {/* Get Quote */}
          {(!shipment || ["draft", "quote_failed", "cancelled", "failed", "delivered"].includes(shipment?.status)) && (
            <>
              {!showForm ? (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-xs"
                  onClick={() => setShowForm(true)}
                  disabled={!!activeShipment}
                >
                  <DollarSign className="w-3 h-3 ml-1" />
                  קבל הצעת מחיר
                </Button>
              ) : (
                <div className="w-full bg-white rounded-lg p-3 border border-emerald-200 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px]">גודל חבילה</Label>
                      <Select value={packageSize} onValueChange={setPackageSize}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ENVELOPE">מעטפה</SelectItem>
                          <SelectItem value="SMALL">קטן</SelectItem>
                          <SelectItem value="MEDIUM">בינוני</SelectItem>
                          <SelectItem value="LARGE">גדול</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px]">הערות למשלוח</Label>
                      <Input value={dropoffNotes} onChange={(e) => setDropoffNotes(e.target.value)} className="h-8 text-xs" placeholder="קומה, דירה..." />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex-1" onClick={handleGetQuote} disabled={actionLoading === "quote"}>
                      {actionLoading === "quote" ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <CheckCircle className="w-3 h-3 ml-1" />}
                      שלח בקשה
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowForm(false)}>ביטול</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Accept Quote */}
          {shipment?.status === "quote_received" && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white rounded-full text-xs"
              onClick={() => handleAcceptQuote(shipment)} disabled={actionLoading === "accept"}>
              {actionLoading === "accept" ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <CheckCircle className="w-3 h-3 ml-1" />}
              אשר משלוח (₪{shipment.quote_price})
            </Button>
          )}

          {/* Refresh Status */}
          {shipment && ["accepted", "pickup_pending", "picked_up", "in_transit"].includes(shipment.status) && (
            <Button size="sm" variant="outline" className="rounded-full text-xs border-emerald-300 text-emerald-700"
              onClick={() => handleRefreshStatus(shipment)} disabled={actionLoading === "refresh"}>
              {actionLoading === "refresh" ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <RefreshCw className="w-3 h-3 ml-1" />}
              רענן סטטוס
            </Button>
          )}

          {/* Send Tracking SMS */}
          {shipment?.tracking_url && !["cancelled", "failed"].includes(shipment.status) && (
            <Button size="sm" variant="outline" className="rounded-full text-xs border-blue-300 text-blue-700"
              onClick={() => handleSendTracking(shipment)} disabled={actionLoading === "sms"}>
              {actionLoading === "sms" ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <Send className="w-3 h-3 ml-1" />}
              שלח קישור מעקב
            </Button>
          )}

          {/* Cancel */}
          {(isManager || isShiftManager) && shipment && !["cancelled", "failed", "delivered"].includes(shipment.status) && (
            <Button size="sm" variant="outline" className="rounded-full text-xs border-red-300 text-red-600"
              onClick={() => handleCancelShipment(shipment)} disabled={actionLoading === "cancel"}>
              {actionLoading === "cancel" ? <Loader2 className="w-3 h-3 animate-spin ml-1" /> : <XCircle className="w-3 h-3 ml-1" />}
              בטל משלוח
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}