import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, Truck, MessageCircle } from "lucide-react";
import { updateWooOrderStatus } from "@/functions/updateWooOrderStatus";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { toast } from "sonner";

/**
 * After a shipment label is created, this dialog prompts the user
 * to confirm updating the order status (WooCommerce → completed, Mirakl → shipped).
 * Also shows info about automatic SMS tracking notification.
 */
export default function PostShipmentConfirmDialog({ open, onClose, order, trackingNumber, onStatusUpdated }) {
  const [updating, setUpdating] = useState(false);
  const [done, setDone] = useState(false);

  if (!order) return null;

  const isWoo = order.source === 'woocommerce';
  const isMirakl = order.source === 'mirakl';
  const statusLabel = isWoo ? 'הושלמה (completed)' : isMirakl ? 'נשלחה (shipped)' : '';

  const handleConfirm = async () => {
    setUpdating(true);
    try {
      if (isWoo) {
        await updateWooOrderStatus({ order_id: order.raw_id, new_status: 'completed' });
        toast.success('הזמנה עודכנה ל-"הושלמה" בווקומרס');
      } else if (isMirakl) {
        await updateSuperPharmOrder({
          action: 'ship',
          order_id: order.mirakl_order_id || order.order_number,
          tracking_number: trackingNumber,
          carrier_code: 'UPS',
        });
        toast.success('הזמנה עודכנה ל-"נשלחה" ב-Mirakl');
      }
      setDone(true);
      if (onStatusUpdated) onStatusUpdated();
    } catch (e) {
      toast.error('שגיאה בעדכון סטטוס: ' + (e?.response?.data?.error || e.message));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => { if (!updating) onClose(); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-700">
            <CheckCircle className="w-6 h-6" />
            שטר מטען נוצר בהצלחה!
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tracking info */}
          {trackingNumber && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
              <p className="text-xs text-green-600 mb-1">מספר מעקב</p>
              <p className="text-xl font-mono font-bold text-green-900">{trackingNumber}</p>
            </div>
          )}

          {/* SMS info */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2">
            <MessageCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold">הודעת SMS מעקב</p>
              {isWoo ? (
                <p className="text-xs mt-1">הודעת SMS עם מספר המעקב תישלח אוטומטית ללקוח בשעות 9:00-21:00 לאחר שמספר המעקב יתעדכן בהזמנה.</p>
              ) : (
                <p className="text-xs mt-1">ניתן לשלוח הודעת SMS ללקוח מתוך אזור המעקב בפרטי ההזמנה.</p>
              )}
            </div>
          </div>

          {/* Status update prompt */}
          {(isWoo || isMirakl) && !done && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-amber-700" />
                <p className="font-bold text-amber-900 text-sm">
                  עדכון סטטוס הזמנה
                </p>
              </div>
              <p className="text-sm text-amber-800">
                {isWoo && <>האם לעדכן את ההזמנה בווקומרס לסטטוס <strong>"הושלמה"</strong>?</>}
                {isMirakl && <>האם לעדכן את ההזמנה ב-Mirakl לסטטוס <strong>"נשלחה"</strong>?</>}
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleConfirm}
                  disabled={updating}
                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-xl shadow-lg"
                >
                  {updating ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <CheckCircle className="w-4 h-4 ml-1" />}
                  {updating ? 'מעדכן...' : `כן, עדכן ל-"${statusLabel}"`}
                </Button>
                <Button variant="outline" onClick={onClose} disabled={updating} className="rounded-xl">
                  לא עכשיו
                </Button>
              </div>
            </div>
          )}

          {/* Done state */}
          {done && (
            <div className="bg-green-50 border border-green-300 rounded-xl p-3 text-center text-green-800 font-semibold text-sm">
              ✅ סטטוס ההזמנה עודכן בהצלחה!
            </div>
          )}

          {/* Close button - always visible when done or for linet orders */}
          {(done || (!isWoo && !isMirakl)) && (
            <Button variant="outline" onClick={onClose} className="w-full rounded-xl">סגור</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}