import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, Copy, Printer, Save, Receipt, Mail } from "lucide-react";
import { printShipmentLabel } from "@/functions/printShipmentLabel";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { createSPLinetInvoice } from "@/functions/createSPLinetInvoice";
import { sendTrackingSms } from "@/functions/sendTrackingSms";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import SPProcessTimeline from "./SPProcessTimeline";

function detectCarrierFromOrder(order) {
  const values = [
    order?._shipCarrier,
    order?.shipment_source,
    order?.tracking_carrier,
    order?.carrier_code,
    order?.carrier_name,
    order?.shipping_carrier_code,
    order?.shipping_company,
  ];

  if (order?.raw_mirakl_json) {
    try {
      const raw = JSON.parse(order.raw_mirakl_json);
      values.push(raw?.shipping_carrier_code, raw?.shipping_company, raw?.shipping_type_code, raw?.shipping_tracking_url);
    } catch (_) {}
  }

  const joined = values.filter(Boolean).join(" ").toLowerCase();
  if (joined.includes("ups") || joined.includes("deliv_ups")) {
    return { key: "ups", code: "deliv_ups", name: "UPS" };
  }

  return { key: "cargo", code: "deliv_cargoexp", name: "Cargo-Ship" };
}

export default function SPShipmentSuccessScreen({ 
  trackingNumber, 
  order,
  onDone,
}) {
  const hasExistingInvoice = !!(order?.linet_invoice_doc_id);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [printingLabel, setPrintingLabel] = useState(null);
  const [invoiceResult, setInvoiceResult] = useState(null);
  const [smsResult, setSmsResult] = useState(null);
  const [step, setStep] = useState("");
  const [sendEmail, setSendEmail] = useState("");
  const [processEvents, setProcessEvents] = useState([]);

  const addProcessEvent = (label, status = "done", details = "") => {
    setProcessEvents(prev => [...prev, {
      label,
      status,
      details,
      time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }]);
  };

  const copyTracking = () => {
    navigator.clipboard.writeText(trackingNumber);
    toast.success("מספר מעקב הועתק");
  };

  const openPrintableLabel = async (format = 'a4') => {
    setPrintingLabel(format);
    try {
      const { data } = await printShipmentLabel({ tracking_number: trackingNumber, label_format: format });
      if (data.success && data.pdf_base64) {
        const byteChars = atob(data.pdf_base64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);

        // Build a full HTML document that embeds the PDF
        const htmlContent = `<!DOCTYPE html>
<html><head><title>שטר מטען - ${trackingNumber}</title>
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}
iframe{width:100%;height:100%;border:none;}</style></head>
<body><iframe src="${blobUrl}#toolbar=1&navpanes=0"></iframe></body></html>`;
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        const htmlUrl = URL.createObjectURL(htmlBlob);

        const opened = window.open(htmlUrl, '_blank');
        if (!opened) {
          // Popup blocked — fallback to download
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = `label-${format}-${trackingNumber}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        toast.success(`שטר מטען ${format === 'a4' ? 'A4' : 'תרמי'} נפתח`);
        addProcessEvent(`שטר מטען ${format === 'a4' ? 'A4' : 'תרמי'} נפתח להדפסה`);
        await handleSaveAndFinalize();
      } else {
        toast.error(data.error || "שגיאה בהורדת שטר מטען");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setPrintingLabel(null);
    }
  };

  const handleSaveAndFinalize = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      addProcessEvent("התחלת סיום טיפול בהזמנה", "running");

      let freshOrder = order;
      try {
        const freshOrders = await base44.entities.SuperPharmOrder.filter({ mirakl_order_id: order.mirakl_order_id }, null, 1);
        if (freshOrders.length > 0) freshOrder = freshOrders[0];
      } catch (_) {}

      // Step 1: Update Mirakl with tracking + mark as shipped
      setStep("מעדכן מספר מעקב ב-Mirakl...");
      const detectedCarrier = detectCarrierFromOrder(order?._shipCarrier ? order : freshOrder);
      const { data: miraklResult } = await updateSuperPharmOrder({
        action: "ship",
        order_id: order.mirakl_order_id,
        tracking_number: trackingNumber,
        carrier_code: detectedCarrier.code,
        carrier_name: detectedCarrier.name,
      });

      if (!miraklResult.success) {
        toast.error("שגיאה בעדכון Mirakl: " + (miraklResult.error || ""));
        addProcessEvent("עדכון Mirakl נכשל", "error", miraklResult.error || "");
        setSaving(false);
        setStep("");
        return;
      }

      addProcessEvent("Mirakl עודכן — הזמנה סומנה כנשלחה", "done", `חברת שילוח: ${detectedCarrier.name}`);
      toast.success("✅ Mirakl עודכן — הזמנה סומנה כנשלחה");

      // Step 2: Create Linet invoice (only if not already created)
      if (!hasExistingInvoice) {
        setStep("יוצר חשבונית מס-קבלה בלינט...");
        
        let productDesc = "";
        let totalProductPrice = 0;
        let shippingAmount = 0;
        let qty = 1;
        
        try {
          const lines = JSON.parse(freshOrder.order_lines_json || "[]");
          if (lines.length > 0) {
            productDesc = lines.map(l => l.product_title || l.offer_sku).join(", ");
            qty = lines.reduce((sum, l) => sum + (l.quantity || 1), 0);
            totalProductPrice = lines.reduce((sum, l) => sum + (l.total_price || l.price || 0), 0);
          }
        } catch (_) {}

        const orderTotal = freshOrder.total_price || 0;
        if (orderTotal > totalProductPrice && totalProductPrice > 0) {
          shippingAmount = orderTotal - totalProductPrice;
        }

        try {
          const { data: invoiceData } = await createSPLinetInvoice({
            customer_name: `${freshOrder.customer_first_name || ""} ${freshOrder.customer_last_name || ""}`.trim(),
            customer_phone: freshOrder.customer_phone || "",
            customer_email: sendEmail || "",
            product_description: productDesc || `הזמנת סופר-פארם ${freshOrder.mirakl_order_id}`,
            quantity: qty,
            unit_price: totalProductPrice || orderTotal,
            shipping_amount: shippingAmount,
            mirakl_order_id: freshOrder.mirakl_order_id,
            send_email: sendEmail || undefined,
          });

          if (invoiceData.duplicate) {
            setInvoiceResult({ doc_number: invoiceData.existing_doc_number, doc_id: invoiceData.existing_doc_id });
            addProcessEvent("חשבונית לינט כבר קיימת", "warning", invoiceData.existing_doc_number || invoiceData.existing_doc_id || "");
            toast.warning(invoiceData.error);
          } else if (invoiceData.success) {
            setInvoiceResult(invoiceData);
            const emailNote = invoiceData.email_sent ? " ונשלחה במייל" : "";
            addProcessEvent("חשבונית לינט נוצרה", "done", invoiceData.doc_number || invoiceData.doc_id || "");
            toast.success(`✅ חשבונית לינט ${invoiceData.doc_number || invoiceData.doc_id} נוצרה${emailNote}`);
          } else {
            addProcessEvent("יצירת חשבונית לינט נכשלה", "error", invoiceData.error || "");
            toast.error("שגיאה ביצירת חשבונית לינט: " + (invoiceData.error || ""));
          }
        } catch (invErr) {
          addProcessEvent("יצירת חשבונית לינט נכשלה", "error", invErr.message);
          toast.error("שגיאה ביצירת חשבונית: " + invErr.message);
        }
      } else {
        setInvoiceResult({ doc_number: order.linet_invoice_doc_number, doc_id: order.linet_invoice_doc_id });
        addProcessEvent("חשבונית לינט כבר קיימת", "warning", order.linet_invoice_doc_number || order.linet_invoice_doc_id || "");
        toast.info(`חשבונית כבר קיימת: #${order.linet_invoice_doc_number || order.linet_invoice_doc_id}`);
      }

      setStep("שולח SMS מעקב ללקוח...");
      try {
        const customerName = `${freshOrder.customer_first_name || ""} ${freshOrder.customer_last_name || ""}`.trim();
        const { data: smsData } = await sendTrackingSms({
          order_id: freshOrder.id || freshOrder.mirakl_order_id,
          customer_phone: freshOrder.customer_phone || "",
          customer_name: customerName,
          tracking_number: trackingNumber,
          tracking_carrier: detectedCarrier.key,
          order_number: freshOrder.mirakl_order_id,
        });

        if (smsData?.success) {
          setSmsResult(smsData);
          addProcessEvent("SMS מעקב נשלח ללקוח");
          toast.success("✅ SMS מעקב נשלח ללקוח");
        } else {
          addProcessEvent("שליחת SMS נכשלה", "error", smsData?.error || smsData?.message || "");
          toast.error("שגיאה בשליחת SMS: " + (smsData?.error || smsData?.message || ""));
        }
      } catch (smsErr) {
        addProcessEvent("שליחת SMS נכשלה", "error", smsErr.message);
        toast.error("שגיאה בשליחת SMS: " + smsErr.message);
      }

      addProcessEvent("סיום טיפול בהזמנה");
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
            <Button variant="outline" onClick={() => openPrintableLabel('a4')} disabled={!!printingLabel}>
              {printingLabel === 'a4' ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
              📄 הדפס A4
            </Button>
            <Button variant="outline" onClick={() => openPrintableLabel('thermal')} disabled={!!printingLabel}>
              {printingLabel === 'thermal' ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Printer className="w-4 h-4 ml-1" />}
              🖨️ תווית תרמית
            </Button>
          </div>

          <SPProcessTimeline events={processEvents} />

          {/* Save & Finalize */}
          {!saved ? (
            <div className="pt-2 border-t space-y-3">
              {/* Email field */}
              <div className="text-right">
                <Label className="text-xs text-gray-600 flex items-center gap-1 mb-1">
                  <Mail className="w-3.5 h-3.5" />
                  מייל לשליחת חשבונית (אופציונלי)
                </Label>
                <Input 
                  value={sendEmail} 
                  onChange={e => setSendEmail(e.target.value)} 
                  placeholder="example@email.com"
                  type="email"
                  dir="ltr"
                  className="text-left"
                />
              </div>

              <p className="text-xs text-gray-500">
                לאחר פתיחת התווית להדפסה המערכת תעדכן את Mirakl, תיצור חשבונית לינט ותשלח SMS מעקב ללקוח.
                {sendEmail && " החשבונית תישלח גם במייל."}
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
                    המשך עכשיו — Mirakl + חשבונית + SMS
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
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800 space-y-1">
                  <div className="flex items-center gap-1">
                    <Receipt className="w-4 h-4" />
                    <span>חשבונית מס-קבלה #{invoiceResult.doc_number || invoiceResult.doc_id} נוצרה בלינט</span>
                  </div>
                  {invoiceResult.email_sent && (
                    <div className="text-xs text-purple-600 flex items-center gap-1">
                      <Mail className="w-3 h-3" /> נשלחה למייל {sendEmail}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  ⚠️ חשבונית לינט לא נוצרה — יש ליצור ידנית
                </div>
              )}
              {smsResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                  ✅ SMS מעקב נשלח ללקוח
                </div>
              )}
              <Button onClick={onDone} className="w-full">
                סגור
              </Button>
            </div>
          )}

          {!saved && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              אין לסגור לפני סיום התהליך — לאחר פתיחת התווית המערכת תמשיך אוטומטית לחשבונית ו-SMS.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}