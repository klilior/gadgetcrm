import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, Truck, MessageCircle } from "lucide-react";
import { updateWooOrderStatus } from "@/functions/updateWooOrderStatus";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { sendTrackingSms } from "@/functions/sendTrackingSms";
import { toast } from "sonner";

/**
 * After a shipment label is created, this dialog automatically:
 * 1. Updates the order status (WooCommerce → completed, Mirakl → shipped)
 * 2. Sends tracking SMS to the customer
 * Also allows manual retry if something fails.
 */
export default function PostShipmentConfirmDialog({ open, onClose, order, trackingNumber, onStatusUpdated }) {
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusDone, setStatusDone] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [smsUpdating, setSmsUpdating] = useState(false);
  const [smsDone, setSmsDone] = useState(false);
  const [smsError, setSmsError] = useState(null);
  const autoRanRef = useRef(false);

  const isWoo = order?.source === 'woocommerce';
  const isMirakl = order?.source === 'mirakl';
  const carrier = order?.tracking_carrier || (order?.cargo_shipment_id ? 'cargo' : 'ups');

  const updateStatus = async () => {
    if (!order) return;
    setStatusUpdating(true);
    setStatusError(null);
    try {
      if (isWoo) {
        await updateWooOrderStatus({ order_id: order.raw_id, new_status: 'completed' });
        toast.success('הזמנה עודכנה ל-"הושלמה" בווקומרס');
      } else if (isMirakl) {
        await updateSuperPharmOrder({
          action: 'ship',
          order_id: order.mirakl_order_id || order.order_number,
          tracking_number: trackingNumber,
          carrier_code: carrier === 'cargo' ? 'deliv_cargoexp' : 'deliv_ups',
          carrier_name: carrier === 'cargo' ? 'Cargo-Ship' : 'UPS',
        });
        toast.success('הזמנה עודכנה ל-"נשלחה" ב-Mirakl');
      }
      setStatusDone(true);
      if (onStatusUpdated) onStatusUpdated();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      setStatusError(msg);
      toast.error('שגיאה בעדכון סטטוס: ' + msg);
    } finally {
      setStatusUpdating(false);
    }
  };

  const sendSms = async () => {
    if (!order?.customer_phone || !trackingNumber) return;
    setSmsUpdating(true);
    setSmsError(null);
    try {
      await sendTrackingSms({
        order_id: order.raw_id || order.id,
        customer_phone: order.customer_phone,
        customer_name: order.customer_name,
        tracking_number: trackingNumber,
        tracking_carrier: carrier,
        tracking_url: order.tracking_url || '',
        order_number: order.order_number || order.external_order_number,
      });
      setSmsDone(true);
      toast.success('SMS מעקב נשלח ללקוח');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      setSmsError(msg);
      toast.error('שגיאה בשליחת SMS: ' + msg);
    } finally {
      setSmsUpdating(false);
    }
  };

  // Auto-run both actions on mount
  useEffect(() => {
    if (!open || autoRanRef.current || !order || !trackingNumber) return;
    autoRanRef.current = true;
    // Run both in parallel
    updateStatus();
    sendSms();
  }, [open, order, trackingNumber]);

  const allDone = (statusDone || (!isWoo && !isMirakl)) && (smsDone || !order?.customer_phone);
  const anyLoading = statusUpdating || smsUpdating;

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={() => { if (!anyLoading) onClose(); }}>
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

          {/* Status update row */}
          {(isWoo || isMirakl) && (
            <div className={`rounded-xl p-3 flex items-center justify-between ${statusDone ? 'bg-green-50 border border-green-200' : statusError ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium">
                  {isWoo ? 'עדכון ווקומרס ל-"הושלמה"' : 'עדכון Mirakl ל-"נשלחה"'}
                </span>
              </div>
              {statusUpdating && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
              {statusDone && <span className="text-green-600 text-sm font-bold">✅</span>}
              {statusError && (
                <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-300" onClick={updateStatus}>
                  נסה שוב
                </Button>
              )}
            </div>
          )}

          {/* SMS row */}
          {order.customer_phone && (
            <div className={`rounded-xl p-3 flex items-center justify-between ${smsDone ? 'bg-green-50 border border-green-200' : smsError ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium">שליחת SMS מעקב ללקוח</span>
              </div>
              {smsUpdating && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
              {smsDone && <span className="text-green-600 text-sm font-bold">✅</span>}
              {smsError && (
                <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-300" onClick={sendSms}>
                  נסה שוב
                </Button>
              )}
            </div>
          )}

          {/* All done */}
          {allDone && (
            <div className="bg-green-50 border border-green-300 rounded-xl p-3 text-center text-green-800 font-semibold text-sm">
              ✅ כל הפעולות בוצעו בהצלחה!
            </div>
          )}

          <Button variant="outline" onClick={onClose} disabled={anyLoading} className="w-full rounded-xl">
            {anyLoading ? 'ממתין...' : 'סגור'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}