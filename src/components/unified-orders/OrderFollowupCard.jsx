import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { format } from "date-fns";

const TYPE_LABELS = {
  return: "החזרה",
  exchange: "החלפה",
  issue: "תקלה",
  other: "אחר",
};

const STATUS_LABELS = {
  open: "פתוח",
  shipment_created: "משלוח נוצר",
  closed: "סגור",
};

function fmt(d) {
  if (!d) return "-";
  try { return format(new Date(d), "dd/MM/yyyy HH:mm"); } catch { return "-"; }
}

export default function OrderFollowupCard({ followup, currentUser, onClosed, onCreateShipment }) {
  const [closing, setClosing] = useState(false);

  const handleClose = async () => {
    setClosing(true);
    try {
      await base44.entities.OrderFollowup.update(followup.id, {
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: currentUser?.employee_name || currentUser?.full_name || "לא ידוע",
      });
      // Log closure
      await base44.entities.SerialAuditLog.create({
        order_id: followup.original_order_id,
        action: "followup_closed",
        new_value: `טיפול המשך נסגר (${TYPE_LABELS[followup.followup_type]})`,
        user: currentUser?.employee_name || currentUser?.full_name || "לא ידוע",
        result: "success",
      }).catch(() => {});
      toast.success("טיפול המשך נסגר");
      onClosed?.();
    } catch (e) {
      toast.error("שגיאה בסגירת טיפול: " + e.message);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="border border-orange-200 bg-orange-50 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-orange-900">↩️ טיפול המשך פתוח</span>
          <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">
            {TYPE_LABELS[followup.followup_type] || followup.followup_type}
          </Badge>
          <Badge className={`text-xs border ${
            followup.status === "open" ? "bg-green-50 text-green-700 border-green-200" :
            followup.status === "shipment_created" ? "bg-blue-50 text-blue-700 border-blue-200" :
            "bg-gray-100 text-gray-600 border-gray-200"
          }`}>
            {STATUS_LABELS[followup.status] || followup.status}
          </Badge>
        </div>
        {followup.status !== "closed" && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl text-xs border-orange-300 text-orange-800 hover:bg-orange-100"
            onClick={handleClose}
            disabled={closing}
          >
            {closing ? "סוגר..." : "✅ סגור טיפול"}
          </Button>
        )}
      </div>

      <div className="text-sm text-orange-800 space-y-1">
        <div><span className="font-semibold">סיבה:</span> {followup.reason_note}</div>
        <div><span className="font-semibold">נפתח ע"י:</span> {followup.created_by} ב-{fmt(followup.created_date || followup.created_at)}</div>
        {followup.new_shipment_created_at && (
          <div><span className="font-semibold">משלוח חדש נוצר:</span> {fmt(followup.new_shipment_created_at)}</div>
        )}
      </div>

      {/* Shipment creation inside followup */}
      {followup.status === "open" && onCreateShipment && (
        <div className="pt-2 border-t border-orange-200">
          <p className="text-xs text-orange-700 mb-2">ניתן ליצור משלוח חדש במסגרת טיפול המשך זה:</p>
          <Button
            size="sm"
            className="bg-[#7D0F82] hover:bg-[#6a0c6f] text-white rounded-xl text-xs"
            onClick={() => onCreateShipment(followup)}
          >
            🚚 צור משלוח חדש לטיפול המשך
          </Button>
        </div>
      )}
    </div>
  );
}