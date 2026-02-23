import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Clock, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";

export default function RepairSmsHistory({ repairId, clientPhone }) {
  const [smsLogs, setSmsLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repairId && !clientPhone) { setLoading(false); return; }
    loadSmsHistory();
  }, [repairId, clientPhone]);

  const loadSmsHistory = async () => {
    setLoading(true);
    try {
      // Get logs that match this repair's fingerprint OR phone
      let logs = [];
      if (repairId) {
        // Search by fingerprint containing the repair id
        const allLogs = await base44.entities.NotificationLog.filter(
          { to_phone: clientPhone },
          "-sent_at",
          50
        );
        // Filter to only repair-related SMS for this specific repair
        logs = (allLogs || []).filter(log => {
          const fp = log.fingerprint || "";
          const evt = log.event_type || "";
          return fp.includes(repairId) || evt.includes("repair");
        });
      }
      setSmsLogs(logs);
    } catch (e) {
      console.error("Error loading SMS history:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return null;
  if (smsLogs.length === 0) return null;

  const getStatusIcon = (status) => {
    if (status === "נשלח") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    if (status === "נכשל") return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    return <Clock className="w-3.5 h-3.5 text-gray-400" />;
  };

  const getEventLabel = (eventType) => {
    if (!eventType) return "SMS";
    if (eventType.includes("בטיפול")) return "התקבל במעבדה";
    if (eventType.includes("סיים תיקון")) return "מוכן לאיסוף";
    if (eventType.includes("הוזמן חלק")) return "הוזמן חלק";
    if (eventType.includes("לא ניתן")) return "לא ניתן לתיקון";
    if (eventType.includes("נסגר")) return "תיקון נסגר";
    if (eventType.includes("manual")) return "הודעה ידנית";
    return eventType.replace("repair_status_", "");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="w-4 h-4 text-teal-600" />
        <span className="font-semibold text-sm text-gray-700">הודעות SMS שנשלחו ({smsLogs.length})</span>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {smsLogs.map(log => (
          <div key={log.id} className="flex items-start gap-3 p-2.5 bg-teal-50/50 rounded-lg border border-teal-100">
            {getStatusIcon(log.status)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <Badge variant="outline" className="text-[10px] bg-white">
                  {getEventLabel(log.event_type)}
                </Badge>
                <span className="text-[10px] text-gray-500 whitespace-nowrap">
                  {log.sent_at
                    ? format(new Date(log.sent_at), "dd/MM/yy HH:mm")
                    : format(new Date(log.created_date), "dd/MM/yy HH:mm")}
                </span>
              </div>
              <p className="text-xs text-gray-600 line-clamp-2">{log.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}