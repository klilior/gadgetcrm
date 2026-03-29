import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Truck, CheckCircle, FileText, Copy } from "lucide-react";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { veloOrder } from "@/functions/veloOrder";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

function parseOrderLines(order) {
  try { return JSON.parse(order.order_lines_json || "[]"); } catch { return []; }
}

function parseAddress(order) {
  let street = order.shipping_street || "";
  let number = "";
  if (street) {
    const match = street.match(/^(.+?)\s+(\d+[א-ת]?)$/);
    if (match) { street = match[1].trim(); number = match[2]; }
  }
  if (!number) {
    const match2 = street.match(/(\d+)/);
    if (match2) number = match2[1];
    else number = "1";
  }
  return { street, number };
}

export default function SPShipDialog({ order, open, onClose, onSuccess, onCreateInvoice }) {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrierName, setCarrierName] = useState("קרגו שליחויות");
  const [loading, setLoading] = useState(false);
  const [veloLoading, setVeloLoading] = useState(false);
  const [veloStep, setVeloStep] = useState("");
  const [successData, setSuccessData] = useState(null);

  const handleVeloShip = async () => {
    setVeloLoading(true);
    setVeloStep("יוצר משלוח ב-Velo...");
    try {
      const lines = parseOrderLines(order);
      const { street, number } = parseAddress(order);

      const products = lines.map(l => ({
        name: l.product_title || l.offer_sku || "מוצר",
        code: l.offer_sku || "SP",
        variation: "",
        price: l.total_price || l.price || 0,
        quantity: l.quantity || 1
      }));

      const { data } = await veloOrder({
        superpharm: {
          miraklOrderId: order.mirakl_order_id,
          firstName: order.customer_first_name || "לקוח",
          lastName: order.customer_last_name || "-",
          phone: order.customer_phone || "",
          city: order.shipping_city || "",
          street: street,
          number: number,
          zip: order.shipping_zip || "",
          note: `הזמנת סופר-פארם #${order.mirakl_order_id}`,
          polygonId: "cargo_deliv",
          weight: 1,
          products
        }
      });

      if (!data.success) {
        toast.error(data.error || "שגיאה ביצירת משלוח ב-Velo");
        setVeloLoading(false);
        setVeloStep("");
        return;
      }

      const tn = data.tracking_number;
      const labelUrl = data.label_url;

      // Auto-fill the tracking fields
      if (tn) setTrackingNumber(tn);
      setCarrierName("קרגו שליחויות");

      setVeloStep("מעדכן ב-Mirakl...");

      // Update Mirakl + local entity
      if (tn) {
        const updateResult = await updateSuperPharmOrder({
          action: "ship",
          order_id: order.mirakl_order_id,
          tracking_number: tn,
          carrier_code: "cargo_deliv",
          carrier_name: "Cargo-Ship",
        });

        if (!updateResult.data?.success) {
          toast.error("שטר מטען נוצר אבל לא הצלחנו לעדכן ב-Mirakl: " + (updateResult.data?.error || ""));
          setVeloLoading(false);
          setVeloStep("");
          return;
        }
      }

      // Save sticker_url on the entity
      if (labelUrl) {
        try {
          const orders = await base44.entities.SuperPharmOrder.filter({ mirakl_order_id: order.mirakl_order_id }, null, 1);
          if (orders.length > 0) {
            await base44.entities.SuperPharmOrder.update(orders[0].id, { sticker_url: labelUrl });
          }
        } catch (_e) {
          console.warn("Could not save sticker_url:", _e);
        }
      }

      // Show success
      setSuccessData({
        tracking_number: tn,
        label_url: labelUrl,
        velo_order_id: data.velo_order_id,
        service_name: data.service_name || "קרגו שליחויות",
      });

      toast.success("משלוח נוצר ואושר ב-Velo + עודכן ב-Mirakl!");
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setVeloLoading(false);
      setVeloStep("");
    }
  };

  const handleManualShip = async () => {
    if (!trackingNumber.trim()) {
      toast.error("יש להזין מספר מעקב");
      return;
    }
    setLoading(true);
    try {
      const { data } = await updateSuperPharmOrder({
        action: "ship",
        order_id: order.mirakl_order_id,
        tracking_number: trackingNumber.trim(),
        carrier_code: "OTHER",
        carrier_name: carrierName.trim() || "Other",
      });
      if (data.success) {
        toast.success(data.message);
        onSuccess?.();
        onClose();
      } else {
        toast.error(data.error || "שגיאה");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyTracking = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("מספר מעקב הועתק");
  };

  // ===== SUCCESS SCREEN =====
  if (successData) {
    const hasCargoBarcodeReady = successData.tracking_number && successData.tracking_number !== successData.velo_order_id;
    return (
      <Dialog open={true} onOpenChange={() => {}}>
        <DialogContent className="max-w-md" dir="rtl" onPointerDownOutside={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}>
          <div className="text-center py-6 space-y-4">
            <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
            <h2 className="text-xl font-bold text-green-800">✅ משלוח נוצר ואושר בהצלחה!</h2>

            <div className="bg-green-50 rounded-xl p-4 space-y-3">
              {successData.velo_order_id && (
                <div>
                  <div className="text-xs text-gray-500">מזהה משלוח Velo:</div>
                  <div className="text-xl font-mono font-bold text-green-700 flex items-center justify-center gap-2">
                    {successData.velo_order_id}
                    <Button size="icon" variant="ghost" onClick={() => copyTracking(successData.velo_order_id)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
              {hasCargoBarcodeReady && (
                <div>
                  <div className="text-xs text-gray-500">ברקוד קרגו:</div>
                  <div className="text-2xl font-mono font-bold text-green-700 flex items-center justify-center gap-2">
                    {successData.tracking_number}
                    <Button size="icon" variant="ghost" onClick={() => copyTracking(successData.tracking_number)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
              {!hasCargoBarcodeReady && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  ⚠️ ברקוד קרגו יוקצה בדקות הקרובות — ניתן לצפות בדשבורד Velo בעוד כמה דקות
                </div>
              )}
              <div className="text-sm text-gray-600">
                שליח: <span className="font-medium">{successData.service_name} (Velo)</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              {successData.label_url && (
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => window.open(successData.label_url, "_blank")}
                >
                  <FileText className="w-4 h-4 ml-2" />
                  📄 הצג תעודת משלוח
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                onClick={() => window.open(`https://app.veloapp.io/dashboard/orders`, "_blank")}
              >
                📂 צפה בדשבורד Velo
              </Button>

              {onCreateInvoice && (
                <Button
                  variant="outline"
                  className="w-full border-purple-300 text-purple-700 hover:bg-purple-50"
                  onClick={() => {
                    onCreateInvoice(order);
                    setSuccessData(null);
                    onClose();
                  }}
                >
                  💳 צור חשבונית לינט
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSuccessData(null);
                  onSuccess?.();
                  onClose();
                }}
              >
                סגור
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ===== MAIN FORM =====
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            שליחת הזמנה #{order?.mirakl_order_id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Order summary */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            <div><span className="text-gray-500">לקוח:</span> {order?.customer_first_name} {order?.customer_last_name}</div>
            <div><span className="text-gray-500">עיר:</span> {order?.shipping_city}</div>
            <div><span className="text-gray-500">כתובת:</span> {order?.shipping_street}</div>
            {order?.customer_phone && <div><span className="text-gray-500">טלפון:</span> {order?.customer_phone}</div>}
          </div>

          {/* Velo auto-ship button */}
          <Button
            onClick={handleVeloShip}
            disabled={veloLoading || loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 text-base"
          >
            {veloLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin ml-2" />
                {veloStep}
              </>
            ) : (
              <>🚚 שלח Velo — משלוח עד הבית</>
            )}
          </Button>

          <div className="relative flex items-center gap-2 text-xs text-gray-400">
            <div className="flex-1 border-t" />
            <span>או הזנה ידנית</span>
            <div className="flex-1 border-t" />
          </div>

          {/* Manual tracking entry */}
          <div>
            <Label>מספר מעקב *</Label>
            <Input
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              placeholder="הזן מספר מעקב"
              dir="ltr"
              className="text-right mt-1"
              disabled={veloLoading}
            />
          </div>
          <div>
            <Label>חברת שילוח</Label>
            <Input
              value={carrierName}
              onChange={e => setCarrierName(e.target.value)}
              placeholder="קרגו שליחויות"
              className="mt-1"
              disabled={veloLoading}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onClose} disabled={loading || veloLoading} className="flex-1">
              ביטול
            </Button>
            <Button
              onClick={handleManualShip}
              disabled={loading || veloLoading || !trackingNumber.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Truck className="w-4 h-4 ml-2" />}
              אשר משלוח ידני
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}