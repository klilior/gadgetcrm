import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Loader2, AlertTriangle } from "lucide-react";
import { sendTextMeSMS } from "@/functions/sendTextMeSMS";

export default function SendSmsOrderModal({ open, onClose, customerName, customerPhone, orderNumber, orderSource }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const charCount = message.length;
  const isDouble = charCount > 160;

  const handleSend = async () => {
    if (!message.trim() || !customerPhone) return;
    setSending(true);
    setResult(null);
    try {
      const res = await sendTextMeSMS({
        action: "send",
        to_phone: customerPhone,
        message: message.trim(),
        event_type: `unified_order_sms_${orderSource}`,
        fingerprint: `order_sms|${orderNumber}|${Date.now()}`,
      });
      const data = res.data || res;
      if (data.success) {
        setResult({ success: true, text: "ההודעה נשלחה בהצלחה!" });
        setTimeout(() => { onClose(); setMessage(""); setResult(null); }, 1500);
      } else {
        setResult({ success: false, text: data.error || "שגיאה בשליחה" });
      }
    } catch (err) {
      setResult({ success: false, text: err.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-600" />
            שליחת SMS
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 space-y-1">
            <p className="text-sm"><span className="font-medium">לקוח:</span> {customerName || "לא ידוע"}</p>
            <p className="text-sm"><span className="font-medium">טלפון:</span> {customerPhone || "לא ידוע"}</p>
            <p className="text-sm"><span className="font-medium">הזמנה:</span> #{orderNumber}</p>
          </div>

          <div>
            <textarea
              className="w-full border rounded-lg p-3 text-sm resize-none focus:ring-2 focus:ring-blue-400 focus:outline-none"
              rows={4}
              placeholder="כתוב את ההודעה כאן..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              dir="rtl"
            />
            <div className="flex justify-between items-center mt-1">
              <span className={`text-xs ${isDouble ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                {charCount}/160 {isDouble && "⚠️ הודעה כפולה"}
              </span>
            </div>
          </div>

          {result && (
            <div className={`p-3 rounded-lg text-sm ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {result.text}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button
            onClick={handleSend}
            disabled={!message.trim() || !customerPhone || sending}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Send className="w-4 h-4 ml-2" />}
            שלח
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}