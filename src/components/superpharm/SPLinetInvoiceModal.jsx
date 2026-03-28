import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Receipt } from "lucide-react";
import { createLinetInvoice } from "@/functions/createLinetInvoice";
import { toast } from "sonner";

export default function SPLinetInvoiceModal({ order, open, onClose }) {
  const lines = useMemo(() => {
    try { return JSON.parse(order?.order_lines_json || "[]"); } catch { return []; }
  }, [order]);

  const [customerName, setCustomerName] = useState(
    `${order?.customer_first_name || ""} ${order?.customer_last_name || ""}`.trim()
  );
  const [phone, setPhone] = useState(order?.customer_phone || "");
  const [productName, setProductName] = useState(
    lines.map(l => l.product_title || l.offer_sku).join(", ")
  );
  const [totalPrice, setTotalPrice] = useState(order?.total_price || 0);
  const [needsSerial, setNeedsSerial] = useState(false);
  const [sku, setSku] = useState(lines[0]?.offer_sku || "");
  const [serialNumber, setSerialNumber] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const payload = {
        customerName,
        phone,
        productName,
        totalPrice: Number(totalPrice),
        miraklOrderId: order.mirakl_order_id,
        needsSerial,
        sku: needsSerial ? sku : undefined,
        serialNumber: needsSerial ? serialNumber : undefined,
      };
      const { data } = await createLinetInvoice(payload);
      if (data.success) {
        toast.success("חשבונית נוצרה בהצלחה");
        onClose();
      } else {
        toast.error(data.error || "שגיאה ביצירת חשבונית");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-purple-600" />
            צור חשבונית לינט — #{order.mirakl_order_id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>שם לקוח</Label>
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>
          <div>
            <Label>טלפון</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} dir="ltr" />
          </div>
          <div>
            <Label>שם מוצר</Label>
            <Input value={productName} onChange={e => setProductName(e.target.value)} />
          </div>
          <div>
            <Label>מחיר כולל מע״מ (₪)</Label>
            <Input type="number" value={totalPrice} onChange={e => setTotalPrice(e.target.value)} dir="ltr" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="needsSerial"
              checked={needsSerial}
              onCheckedChange={setNeedsSerial}
            />
            <Label htmlFor="needsSerial" className="cursor-pointer">צריך סריאלי?</Label>
          </div>

          {needsSerial && (
            <div className="space-y-3 pr-6 border-r-2 border-purple-200">
              <div>
                <Label>מק״ט</Label>
                <Input value={sku} onChange={e => setSku(e.target.value)} />
              </div>
              <div>
                <Label>מספר סריאל</Label>
                <Input value={serialNumber} onChange={e => setSerialNumber(e.target.value)} />
              </div>
            </div>
          )}

          <Button
            onClick={handleCreate}
            disabled={loading || !customerName || !productName || !totalPrice}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Receipt className="w-4 h-4 ml-2" />}
            צור חשבונית
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}