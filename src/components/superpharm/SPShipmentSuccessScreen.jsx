import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, Copy, Printer, Save, Receipt } from "lucide-react";
import { printShipmentLabel } from "@/functions/printShipmentLabel";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { createSPLinetInvoice } from "@/functions/createSPLinetInvoice";
import { toast } from "sonner";

export default function SPShipmentSuccessScreen({ 
  trackingNumber, 
  order, // SuperPharmOrder entity
  onDone, // called when fully done
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printingLabel, setPrintingLabel] = useState(null);
  const [invoiceResult, setInvoiceResult] = useState(null);
  const [step, setStep] = useState(""); // current step description

  const copyTracking = () => {
    navigator.clipboard.writeText(trackingNumber);
    toast.success("מספר מעקב הועתק");
  };

  const openPrintableLabel = async (format = 'a4') => {
    // Open blank window immediately to avoid popup blockers
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(`<html dir="rtl"><head><title>שטר מטען - ${trackingNumber}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Arial;font-size:20px;color:#555;}</style></head><body>⏳ טוען שטר מטען PDF...</body></html>`);
      newWindow.document.close();
    }

    setPrintingLabel(format);
    try {
      const { data } = await printShipmentLabel({ tracking_number: trackingNumber, label_format: format });
      if (data.success && data.pdf_base64) {
        const dataUri = `data:application/pdf;base64,${data.pdf_base64}`;
        if (newWindow && !newWindow.closed) {
          newWindow.location.href = dataUri;
        } else {
          // Fallback: download
          const a = document.createElement('a');
          a.href = dataUri;
          a.download = `label-${format}-${trackingNumber}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        toast.success(`שטר מטען ${format === 'a4' ? 'A4' : 'תרמי'} נפתח`);
      } else {
        if (newWindow && !newWindow.closed) newWindow.close();
        toast.error(data.error || "שגיאה בהורדת שטר מטען");
      }
    } catch (e) {
      if (newWindow && !newWindow.closed) newWindow.close();
      toast.error("שגיאה: " + e.message);
    } finally {
      setPrintingLabel(null);
    }
  };

  const handleSaveAndFinalize = async () => {
    setSaving(true);
    try {
      // Step 1: Update Mirakl with tracking + mark as shipped
      setStep("מעדכן מספר מעקב ב-Mirakl...");
      const { data: miraklResult } = await updateSuperPharmOrder({
        action: "ship",
        order_id: order.mirakl_order_id,
        tracking_number: trackingNumber,
        carrier_code: "deliv_ups",
        carrier_name: "UPS",
      });

      if (!miraklResult.success) {
        toast.error("שגיאה בעדכון Mirakl: " + (miraklResult.error || ""));
        setSaving(false);
        setStep("");
        return;
      }

      toast.success("✅ Mirakl עודכן — הזמנה סומנה כנשלחה");

      // Step 2: Create Linet invoice
      setStep("יוצר חשבונית מס-קבלה בלינט...");
      
      // Parse order lines for product description
      let productDesc = "";
      let totalProductPrice = 0;
      let shippingAmount = 0;
      let qty = 1;
      
      try {
        const lines = JSON.parse(order.order_lines_json || "[]");
        if (lines.length > 0) {
          productDesc = lines.map(l => l.product_title || l.offer_sku).join(", ");
          qty = lines.reduce((sum, l) => sum + (l.quantity || 1), 0);
          totalProductPrice = lines.reduce((sum, l) => sum + (l.total_price || l.price || 0), 0);
        }
      } catch (_) {}

      // If total_price > totalProductPrice, the difference is shipping
      const orderTotal = order.total_price || 0;
      if (orderTotal > totalProductPrice && totalProductPrice > 0) {
        shippingAmount = orderTotal - totalProductPrice;
      }

      try {
        const { data: invoiceData } = await createSPLinetInvoice({
          customer_name: `${order.customer_first_name || ""} ${order.customer_last_name || ""}`.trim(),
          customer_phone: order.customer_phone || "",
          customer_email: "", // Mirakl doesn't provide email directly
          product_description: productDesc || `הזמנת סופר-פארם ${order.mirakl_order_id}`,
          quantity: qty,
          unit_price: totalProductPrice || orderTotal,
          shipping_amount: shippingAmount,
          mirakl_order_id: order.mirakl_order_id,
        });

        if (invoiceData.success) {
          setInvoiceResult(invoiceData);
          toast.success(`✅ חשבונית לינט ${invoiceData.doc_number || invoiceData.doc_id} נוצרה`);
        } else {
          toast.error("שגיאה ביצירת חשבונית לינט: " + (invoiceData.error || ""));
        }
      } catch (invErr) {
        toast.error("שגיאה ביצירת חשבונית: " + invErr.message);
      }

      setSaved(true);
      setStep("");
    } catch (e) {
      toast.error("שגיאה: " + e.message);
      setStep("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-md" 
        dir="rtl" 
        onPointerDownOutside={e => e.preventDefault()} 
        onInteractOutside={e => e.preventDefault()} 
        hideCloseButton
      >
        <div className="text-center py-4 space-y-4">
          <CheckCircle className="w-14 h-14 mx-auto text-green-500" />
          <h2 className="text-lg font-bold text-green-800">שטר מטען נוצר בהצלחה!</h2>
          
          {/* Tracking Number */}
          <div className="bg-green-50 rounded-xl p-4 space-y-2">
            <div className="text-sm text-gray-600">מספר מעקב:</div>
            <div className="text-2xl font-mono font-bold text-green-700 flex items-center justify-center gap-2">
              {trackingNumber}
              <Button size="icon" variant="ghost" onClick={copyTracking}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Print Buttons */}
          <div className="flex gap-2 justify-center">
            <Button 
              variant="outline" 
              onClick={() => openPrintableLabel('a4')} 
              disabled={!!printingLabel}
            >
              {printingLabel === 'a4' ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
              📄 הדפס A4
            </Button>
            <Button 
              variant="outline" 
              onClick={() => openPrintableLabel('thermal')} 
              disabled={!!printingLabel}
            >
              {printingLabel === 'thermal' ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
              🖨️ תווית תרמית
            </Button>
          </div>

          {/* Save & Finalize Button */}
          {!saved ? (
            <div className="pt-2 border-t space-y-2">
              <p className="text-xs text-gray-500">
                לחיצה על שמירה תעדכן את Mirakl עם מספר המעקב, תסמן כנשלחה ותיצור חשבונית מס-קבלה בלינט
              </p>
              <Button
                onClick={handleSaveAndFinalize}
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 text-base"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin ml-2" />
                    {step}
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5 ml-2" />
                    💾 שמור — עדכן Mirakl + צור חשבונית לינט
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="pt-2 border-t space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                ✅ Mirakl עודכן — הזמנה סומנה כנשלחה
              </div>
              {invoiceResult ? (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
                  <Receipt className="w-4 h-4 inline ml-1" />
                  חשבונית מס-קבלה #{invoiceResult.doc_number || invoiceResult.doc_id} נוצרה בלינט
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  ⚠️ חשבונית לינט לא נוצרה — יש ליצור ידנית
                </div>
              )}
              <Button onClick={onDone} className="w-full">
                סגור
              </Button>
            </div>
          )}

          {/* Cancel without saving */}
          {!saved && (
            <Button variant="ghost" onClick={onDone} disabled={saving} className="text-xs text-gray-400">
              סגור בלי לשמור
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}