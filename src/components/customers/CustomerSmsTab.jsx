import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, Clock, MessageSquare, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";

const getStatusIcon = (status) => {
    if (status === "נשלח") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "נכשל") return <XCircle className="w-4 h-4 text-red-500" />;
    if (status === "כפילות") return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    return <Clock className="w-4 h-4 text-gray-400" />;
};

const getStatusColor = (status) => {
    if (status === "נשלח") return "bg-green-100 text-green-700 border-green-200";
    if (status === "נכשל") return "bg-red-100 text-red-700 border-red-200";
    if (status === "כפילות") return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-gray-100 text-gray-700 border-gray-200";
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

export default function CustomerSmsTab({ smsLogs = [] }) {
    if (smsLogs.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">אין הודעות SMS</p>
                <p className="text-sm mt-1">לא נמצאו הודעות SMS ללקוח זה</p>
            </div>
        );
    }

    const successCount = smsLogs.filter(l => l.status === "נשלח").length;
    const failedCount = smsLogs.filter(l => l.status === "נכשל").length;
    const otherCount = smsLogs.length - successCount - failedCount;

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                    <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto mb-1" />
                    <p className="text-xl font-bold text-green-700">{successCount}</p>
                    <p className="text-xs text-green-600">נשלחו בהצלחה</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                    <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1" />
                    <p className="text-xl font-bold text-red-700">{failedCount}</p>
                    <p className="text-xs text-red-600">נכשלו</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <MessageSquare className="w-5 h-5 text-gray-500 mx-auto mb-1" />
                    <p className="text-xl font-bold text-gray-700">{smsLogs.length}</p>
                    <p className="text-xs text-gray-600">סה"כ</p>
                </div>
            </div>

            {/* SMS List */}
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {smsLogs.map(log => (
                    <Card key={log.id} className="border border-gray-100">
                        <CardContent className="p-3">
                            <div className="flex items-start gap-3">
                                {getStatusIcon(log.status)}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[10px]">
                                                {getEventLabel(log.event_type)}
                                            </Badge>
                                            <Badge className={`text-[10px] ${getStatusColor(log.status)}`}>
                                                {log.status}
                                            </Badge>
                                        </div>
                                        <span className="text-[11px] text-gray-400 whitespace-nowrap">
                                            {log.sent_at
                                                ? format(new Date(log.sent_at), "dd/MM/yy HH:mm", { locale: he })
                                                : format(new Date(log.created_date), "dd/MM/yy HH:mm", { locale: he })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-600 leading-relaxed">{log.message}</p>
                                    {log.provider_response && log.status === "נכשל" && (
                                        <p className="text-[10px] text-red-500 mt-1">שגיאה: {log.provider_response}</p>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}