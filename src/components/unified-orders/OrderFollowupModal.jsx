import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

const FOLLOWUP_TYPES = [
  { value: "return", label: "החזרה" },
  { value: "exchange", label: "החלפה" },
  { value: "issue", label: "תקלה" },
  { value: "other", label: "אחר" },
];

export default function OrderFollowupModal({ order, currentUser, onCreated, onClose }) {
  const [followupType, setFollowupType] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const orderId = order.raw_id || order.id || String(order.order_number || "");
  const orderNumber = order.order_number || order.external_order_number || orderId;

  const canSubmit = followupType && reasonNote.trim().length >= 5 && confirmed;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      const followup = await base44.entities.OrderFollowup.create({
        original_order_id: orderId,
        original_order_source: order.source || "woocommerce",
        original_order_number: String(orderNumber),
        followup_type: followupType,
        reason_note: reasonNote.trim(),
        created_by: currentUser?.employee_name || currentUser?.full_name || "לא ידוע",
        status: "open",
      });

      // Update original order with the new followup_id
      const existingFollowups = order.followup_records || [];
      await base44.entities.Order.update(orderId, {
        followup_records: [...existingFollowups, followup.id],
      }).catch(() => {
        // SP / linet orders may not be in Order entity — that's ok
      });

      // Activity log
      await base44.entities.SerialAuditLog.create({
        order_id: orderId,
        action: "select_serial", // reuse closest action; we log as text
        new_value: `טיפול המשך נפתח: ${followupType} — ${reasonNote.trim()}`,
        user: currentUser?.employee_name || currentUser?.full_name || "לא ידוע",
        result: "success",
      }).catch(() => {});

      toast.success("טיפול המשך נפתח בהצלחה");
      onCreated(followup);
    } catch (e) {
      toast.error("שגיאה בפתיחת טיפול המשך: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-gray-900">
            🔁 פתיחת טיפול המשך — הזמנה #{orderNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Type */}
          <div className="space-y-1">
            <label className="text-sm font-semibold text-gray-700">סוג הטיפול *</label>
            <Select value={followupType} onValueChange={setFollowupType}>
              <SelectTrigger className="w-full rounded-xl border-gray-200">
                <SelectValue placeholder="בחר סוג טיפול" />
              </SelectTrigger>
              <SelectContent>
                {FOLLOWUP_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reason */}
          <div className="space-y-1">
            <label className="text-sm font-semibold text-gray-700">הערה חופשית (מה בדיוק קרה) *</label>
            <Textarea
              value={reasonNote}
              onChange={e => setReasonNote(e.target.value)}
              placeholder="תאר את הבעיה / הסיבה לטיפול המשך..."
              className="min-h-[90px] rounded-xl text-sm border-gray-200"
              maxLength={500}
            />
            {reasonNote.length > 0 && reasonNote.trim().length < 5 && (
              <p className="text-xs text-red-500">נדרש לפחות 5 תווים</p>
            )}
          </div>

          {/* Confirmation checkbox */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3">
            <Checkbox
              id="followup-confirm"
              checked={confirmed}
              onCheckedChange={setConfirmed}
              className="mt-0.5 flex-shrink-0"
            />
            <label htmlFor="followup-confirm" className="text-sm text-amber-900 cursor-pointer leading-snug">
              אני מאשר שזהו טיפול המשך להזמנה מס׳ <strong>#{orderNumber}</strong> שכבר סופקה,
              ולא יצירת הזמנה/משלוח חדש.
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl" disabled={loading}>
            ביטול
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white rounded-xl"
          >
            {loading ? "פותח..." : "פתח טיפול המשך"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}