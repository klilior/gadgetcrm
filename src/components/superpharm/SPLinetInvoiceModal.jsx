import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Receipt, Mail } from "lucide-react";
import { createSPLinetInvoice } from "@/functions/createSPLinetInvoice";
import { toast } from "sonner";

export default function SPLinetInvoiceModal({ order, open, onClose }) {
  const lines = useMemo(() => {
    try { return JSON.parse(order?.order_lines_json || "[]"); } catch { return []; }
  }, [order]);

  const [customerName, setCustomerName] = useState(
    `${order?.customer_first_name || ""} ${order?.customer_last_name || ""}`.trim()
  );
  const [phone, setPhone] = useState(order?.customer_phone || "");
  const [email, setEmail] = useState("");
  const [productName, setProductName] = useState(
    lines.map(l => l.product_title || l.offer_sku).join(", ")
  );
  const [totalPrice, setTotalPrice] = useState(order?.total_price || 0);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      // Calculate shipping as difference between total and product lines
      const productTotal = lines.reduce((sum, l) => sum + (l.total_price || l.price || 0), 0);
      const shippingAmount = (order?.total_price || 0) > productTotal && productTotal > 0
        ? (order.total_price - productTotal)
        : 0;

      const { data } = await createSPLinetInvoice({
        customer_name: customerName,
        customer_phone: phone,
        customer_email: email,
        product_description: productName || `הזמנת סופר-פארם ${order.mirakl_order_id}`,
        quantity: lines.reduce((sum, l) => sum + (l.quantity || 1), 0) || 1,
        unit_price: productTotal || Number(totalPrice),
        shipping_amount: shippingAmount,
        mirakl_order_id: order.mirakl_order_id,
        send_email: email || undefined,
      });

      if (data.success) {
        const emailNote = data.email_sent ? " ונשלחה במייל" : "";
        toast.success(`חשבונית ${data.doc_number || data.doc_id} נוצרה בהצלחה${emailNote}`);
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
            <Input value={phone} onChange={e => setPhone(e.target.value)} dir="ltr" className="text-right" />
          </div>
          <div>
            <Label className="flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" />
              מייל לשליחת חשבונית
            </Label>
            <Input 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              placeholder="example@email.com"
              type="email"
              dir="ltr" 
              className="text-left" 
            />
          </div>
          <div>
            <Label>שם מוצר</Label>
            <Input value={productName} onChange={e => setProductName(e.target.value)} />
          </div>
          <div>
            <Label>מחיר כולל מע״מ (₪)</Label>
            <Input type="number" value={totalPrice} onChange={e => setTotalPrice(e.target.value)} dir="ltr" className="text-right" />
          </div>

          <Button
            onClick={handleCreate}
            disabled={loading || !customerName || !productName || !totalPrice}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Receipt className="w-4 h-4 ml-2" />}
            צור חשבונית {email ? "ושלח במייל" : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}