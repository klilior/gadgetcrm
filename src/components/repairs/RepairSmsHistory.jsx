import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
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
      let logs = [];
      if (clientPhone) {
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

  const getStatusIcon = (status) => {
    if (status === "נשלח") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    if (status === "נכשל") return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    if (status === "כפילות") return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    return <Clock className="w-3.5 h-3.5 text-gray-400" />;
  };

  const getStatusColor = (status) => {
    if (status === "נשלח") return "bg-green-100 text-green-700";
    if (status === "נכשל") return "bg-red-100 text-red-700";
    if (status === "כפילות") return "bg-amber-100 text-amber-700";
    return "bg-gray-100 text-gray-700";
  };

  const getEventLabel = (eventType) => {
    if (!eventType) return "SMS";
    if (eventType.includes("בטיפול")) return "התקבל במעבדה";
    if (eventType.includes("סיים תיקון") || eventType.includes("ממתין לאיסוף")) return "מוכן לאיסוף";
    if (eventType.includes("הוזמן חלק")) return "הוזמן חלק";
    if (eventType.includes("לא ניתן")) return "לא ניתן לתיקון";
    if (eventType.includes("נסגר")) return "תיקון נסגר";
    if (eventType.includes("manual")) return "הודעה ידנית";
    if (eventType.includes("reminder")) return "תזכורת";
    return eventType.replace("repair_status_", "");
  };

  const successCount = smsLogs.filter(l => l.status === "נשלח").length;
  const failedCount = smsLogs.filter(l => l.status === "נכשל").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="w-4 h-4 text-teal-600" />
        <span className="font-semibold text-sm text-gray-700">
          היסטוריית SMS ({smsLogs.length})
        </span>
        {smsLogs.length > 0 && (
          <div className="flex gap-1.5 mr-auto">
            <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">
              <CheckCircle2 className="w-2.5 h-2.5 ml-0.5" /> {successCount}
            </Badge>
            {failedCount > 0 && (
              <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200">
                <XCircle className="w-2.5 h-2.5 ml-0.5" /> {failedCount}
              </Badge>
            )}
          </div>
        )}
      </div>

      {smsLogs.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-3">לא נשלחו הודעות SMS לתיקון זה</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {smsLogs.map(log => (
            <div key={log.id} className="flex items-start gap-3 p-2.5 bg-teal-50/50 rounded-lg border border-teal-100">
              {getStatusIcon(log.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] bg-white">
                      {getEventLabel(log.event_type)}
                    </Badge>
                    <Badge className={`text-[10px] ${getStatusColor(log.status)}`}>
                      {log.status}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-gray-500 whitespace-nowrap">
                    {log.sent_at
                      ? format(new Date(log.sent_at), "dd/MM/yy HH:mm")
                      : format(new Date(log.created_date), "dd/MM/yy HH:mm")}
                  </span>
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{log.message}</p>
                {log.provider_response && log.status === "נכשל" && (
                  <p className="text-[10px] text-red-500 mt-0.5">שגיאה: {log.provider_response}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}