import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Truck } from "lucide-react";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { toast } from "sonner";

export default function SPShipDialog({ order, open, onClose, onSuccess }) {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrierName, setCarrierName] = useState("UPS Israel");
  const [loading, setLoading] = useState(false);

  const handleShip = async () => {
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
        carrier_name: carrierName.trim() || "UPS Israel",
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
          <div>
            <Label>מספר מעקב *</Label>
            <Input
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value)}
              placeholder="הזן מספר מעקב"
              dir="ltr"
              className="text-right mt-1"
              autoFocus
            />
          </div>
          <div>
            <Label>חברת שילוח</Label>
            <Input
              value={carrierName}
              onChange={e => setCarrierName(e.target.value)}
              placeholder="UPS Israel"
              className="mt-1"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
              ביטול
            </Button>
            <Button
              onClick={handleShip}
              disabled={loading || !trackingNumber.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Truck className="w-4 h-4 ml-2" />}
              אשר משלוח
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}