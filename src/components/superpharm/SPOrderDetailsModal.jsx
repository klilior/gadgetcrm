import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, Truck, Package, User, MapPin, Copy } from "lucide-react";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { toast } from "sonner";

const STATE_LABELS = {
  WAITING_ACCEPTANCE: { label: "ממתין לאישור", color: "bg-orange-100 text-orange-800" },
  WAITING_DEBIT: { label: "ממתין לחיוב", color: "bg-yellow-100 text-yellow-800" },
  WAITING_DEBIT_PAYMENT: { label: "ממתין לתשלום", color: "bg-yellow-100 text-yellow-800" },
  SHIPPING: { label: "מוכן למשלוח", color: "bg-blue-100 text-blue-800" },
  SHIPPED: { label: "נשלח", color: "bg-green-100 text-green-800" },
  CLOSED: { label: "נסגר", color: "bg-gray-100 text-gray-800" },
  REFUSED: { label: "נדחה", color: "bg-red-100 text-red-800" },
  CANCELED: { label: "בוטל", color: "bg-red-100 text-red-800" },
};

export default function SPOrderDetailsModal({ order, open, onClose, onRefresh }) {
  const [loading, setLoading] = useState(null);
  const [trackingNumber, setTrackingNumber] = useState(order?.tracking_number || "");
  const [carrierName, setCarrierName] = useState(order?.carrier_name || "UPS Israel");

  if (!order) return null;

  const lines = (() => {
    try { return JSON.parse(order.order_lines_json || "[]"); } catch { return []; }
  })();

  const state = STATE_LABELS[order.order_state] || { label: order.order_state, color: "bg-gray-100" };

  const handleAction = async (action, extraData = {}) => {
    setLoading(action);
    try {
      const payload = { action, order_id: order.mirakl_order_id, ...extraData };
      const { data } = await updateSuperPharmOrder(payload);
      if (data.success) {
        toast.success(data.message);
        onRefresh?.();
        if (action !== "ship") onClose();
      } else {
        toast.error(data.error || "שגיאה");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setLoading(null);
    }
  };

  const copyAddress = () => {
    const addr = `${order.customer_first_name} ${order.customer_last_name}\n${order.shipping_street}\n${order.shipping_city} ${order.shipping_zip}\n${order.customer_phone}`;
    navigator.clipboard.writeText(addr);
    toast.success("כתובת הועתקה");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Package className="w-5 h-5" />
            הזמנה #{order.mirakl_order_id}
            <Badge variant="outline" className={state.color}>{state.label}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Customer Info */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 font-medium">
                  <User className="w-4 h-4 text-gray-500" />
                  פרטי לקוח
                </div>
                <Button size="sm" variant="ghost" onClick={copyAddress}>
                  <Copy className="w-3 h-3 ml-1" /> העתק כתובת
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-gray-500">שם:</span> {order.customer_first_name} {order.customer_last_name}</div>
                <div><span className="text-gray-500">טלפון:</span> {order.customer_phone || "-"}</div>
                <div className="col-span-2 flex items-start gap-1">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <span>{order.shipping_address_full || "-"}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Lines */}
          <Card>
            <CardContent className="p-4">
              <div className="font-medium mb-2 flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-500" />
                פריטים ({lines.length})
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">
                    <div className="flex-1">
                      <div className="font-medium">{line.product_title}</div>
                      <div className="text-xs text-gray-500">SKU: {line.offer_sku} | כמות: {line.quantity}</div>
                    </div>
                    <div className="text-left font-medium">₪{(line.total_price || line.price || 0).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mt-3 pt-3 border-t font-medium">
                <span>סה״כ</span>
                <span className="text-lg">₪{(order.total_price || 0).toLocaleString()}</span>
              </div>
              {order.total_commission > 0 && (
                <div className="flex justify-between items-center text-sm text-gray-500">
                  <span>עמלה</span>
                  <span>₪{order.total_commission.toLocaleString()}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tracking - only for SHIPPING state */}
          {order.order_state === "SHIPPING" && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-4 space-y-3">
                <div className="font-medium flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-600" />
                  שליחת ההזמנה
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>מספר מעקב *</Label>
                    <Input
                      value={trackingNumber}
                      onChange={e => setTrackingNumber(e.target.value)}
                      placeholder="הזן מספר מעקב"
                      dir="ltr"
                      className="text-right"
                    />
                  </div>
                  <div>
                    <Label>חברת שילוח</Label>
                    <Input
                      value={carrierName}
                      onChange={e => setCarrierName(e.target.value)}
                      placeholder="UPS Israel"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => handleAction("ship", { tracking_number: trackingNumber, carrier_name: carrierName })}
                  disabled={loading === "ship" || !trackingNumber}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {loading === "ship" ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Truck className="w-4 h-4 ml-2" />}
                  סמן כנשלח
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Tracking info if shipped */}
          {order.tracking_number && (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-green-800">
                  <CheckCircle className="w-4 h-4" />
                  <span className="font-medium">נשלח</span>
                </div>
                <div className="mt-2 text-sm space-y-1">
                  <div><span className="text-gray-500">מעקב:</span> <span className="font-mono">{order.tracking_number}</span></div>
                  <div><span className="text-gray-500">שליח:</span> {order.carrier_name || order.carrier_code}</div>
                  {order.shipped_at && <div><span className="text-gray-500">תאריך:</span> {new Date(order.shipped_at).toLocaleString("he-IL")}</div>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          {order.order_state === "WAITING_ACCEPTANCE" && (
            <div className="flex gap-3">
              <Button
                onClick={() => handleAction("accept")}
                disabled={!!loading}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {loading === "accept" ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <CheckCircle className="w-4 h-4 ml-2" />}
                אשר הזמנה
              </Button>
              <Button
                onClick={() => handleAction("refuse")}
                disabled={!!loading}
                variant="destructive"
                className="flex-1"
              >
                {loading === "refuse" ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <XCircle className="w-4 h-4 ml-2" />}
                דחה הזמנה
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}