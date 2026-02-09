import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, MessageSquare } from "lucide-react";
import { format } from "date-fns";

const statusColors = {
  "נשלח": "bg-green-100 text-green-800",
  "נכשל": "bg-red-100 text-red-800",
  "ממתין לניסיון חוזר": "bg-yellow-100 text-yellow-800",
  "נחסם-שעות": "bg-orange-100 text-orange-800",
  "כפילות": "bg-gray-100 text-gray-600",
};

export default function SmsLogTable() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    setLoading(true);
    const data = await base44.entities.NotificationLog.list('-sent_at', 30);
    setLogs(data || []);
    setLoading(false);
  };

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-teal-600" />
            הודעות SMS שנשלחו ({logs.length})
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={loadLogs} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-center text-gray-400 py-8">אין הודעות עדיין</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/80">
                  <th className="p-2 text-right text-gray-600">זמן</th>
                  <th className="p-2 text-right text-gray-600">סוג</th>
                  <th className="p-2 text-right text-gray-600">טלפון</th>
                  <th className="p-2 text-right text-gray-600">הודעה</th>
                  <th className="p-2 text-center text-gray-600">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 text-xs text-gray-500 whitespace-nowrap">
                      {log.sent_at ? format(new Date(log.sent_at), 'dd/MM HH:mm') : "—"}
                    </td>
                    <td className="p-2 text-xs">{log.event_type || "—"}</td>
                    <td className="p-2 text-xs font-mono" dir="ltr">{log.to_phone}</td>
                    <td className="p-2 text-xs max-w-[250px] truncate">{log.message}</td>
                    <td className="p-2 text-center">
                      <Badge className={`${statusColors[log.status] || "bg-gray-100 text-gray-700"} text-[10px]`}>
                        {log.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}