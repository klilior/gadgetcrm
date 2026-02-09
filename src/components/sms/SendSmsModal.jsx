import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X, Send, Loader2, FileText, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { sendTextMeSMS } from "@/functions/sendTextMeSMS";

export default function SendSmsModal({ isOpen, onClose, phone, customerName, context }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMessage("");
      loadTemplates();
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    const all = await base44.entities.NotificationTemplate.filter({ is_active: true });
    setTemplates(all || []);
  };

  const applyTemplate = (template) => {
    let text = template.hebrew_template || "";
    // Replace common placeholders with context values
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        text = text.replace(new RegExp(`\\{${key}\\}`, "g"), value || "");
        text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
      });
    }
    if (customerName) {
      text = text.replace(/\{customer_name\}/g, customerName);
      text = text.replace(/\{\{customer_name\}\}/g, customerName);
    }
    setMessage(text);
    setShowTemplates(false);
  };

  const handleSend = async () => {
    if (!phone) { toast.error("חסר מספר טלפון"); return; }
    if (!message.trim()) { toast.error("הודעה ריקה"); return; }

    setSending(true);
    try {
      const res = await sendTextMeSMS({
        action: "send",
        to_phone: phone,
        message: message.trim(),
        event_type: "manual_sms",
      });
      const data = res.data || res;
      if (data.success) {
        toast.success("ההודעה נשלחה בהצלחה!");
        onClose();
      } else {
        toast.error(data.error || "שגיאה בשליחה");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-l from-teal-500 to-teal-600 rounded-t-2xl text-white">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            <h3 className="font-bold text-lg">שליחת SMS</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/20">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-5 space-y-4">
          {/* Recipient */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm text-gray-500">נמען</p>
              <p className="font-semibold text-gray-800">
                {customerName && <span>{customerName} • </span>}
                <span dir="ltr" className="text-blue-600">{phone}</span>
              </p>
            </div>
          </div>

          {/* Templates Button */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTemplates(!showTemplates)}
              className="gap-1.5"
            >
              <FileText className="w-4 h-4" />
              תבניות מוכנות ({templates.length})
            </Button>
          </div>

          {/* Templates List */}
          {showTemplates && templates.length > 0 && (
            <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  className="w-full text-right p-3 hover:bg-teal-50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm text-gray-800">{t.template_key}</span>
                    <Badge variant="outline" className="text-[10px]">SMS</Badge>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{t.hebrew_template}</p>
                </button>
              ))}
            </div>
          )}

          {showTemplates && templates.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-3">אין תבניות. ניתן להוסיף בהגדרות → SMS</p>
          )}

          {/* Message */}
          <div>
            <Label className="font-semibold">הודעה</Label>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="כתוב הודעה חופשית..."
              rows={5}
              className="mt-1"
              dir="rtl"
            />
            <p className="text-xs text-gray-400 mt-1 text-left">{message.length}/1005</p>
          </div>

          {/* Send */}
          <Button
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white py-5 text-base"
          >
            {sending ? <Loader2 className="w-5 h-5 ml-2 animate-spin" /> : <Send className="w-5 h-5 ml-2" />}
            {sending ? "שולח..." : "שלח SMS"}
          </Button>
        </div>
      </div>
    </div>
  );
}