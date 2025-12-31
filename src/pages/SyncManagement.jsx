import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
    RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, 
    Play, Calendar, Database, TrendingUp, History
} from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { toast } from "sonner";

export default function SyncManagement() {
    const { currentUser } = useUser();
    const [metadata, setMetadata] = useState(null);
    const [logs, setLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);

    // Manual sync form
    const [manualDateFrom, setManualDateFrom] = useState(format(startOfDay(new Date()), 'yyyy-MM-dd'));
    const [manualDateTo, setManualDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

    const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [metadataList, logsList] = await Promise.all([
                base44.entities.SyncMetadata.filter({ sync_key: "linet_main_sync" }),
                base44.entities.SyncLog.filter({ sync_key: "linet_main_sync" }, '-run_started_at', 50)
            ]);

            setMetadata(metadataList[0] || null);
            setLogs(logsList);
        } catch (error) {
            console.error("Error loading sync data:", error);
            toast.error("שגיאה בטעינת נתוני סנכרון");
        } finally {
            setIsLoading(false);
        }
    };

    const handleManualSync = async () => {
        setIsSyncing(true);
        try {
            const fromDatetime = new Date(manualDateFrom).toISOString();
            const toDatetime = endOfDay(new Date(manualDateTo)).toISOString();

            toast.info("מתחיל סנכרון...", { duration: 2000 });

            const result = await base44.functions.invoke('runLinetSync', {
                from_datetime: fromDatetime,
                to_datetime: toDatetime,
                trigger_type: "MANUAL",
                update_last_successful: false // Don't update last successful for manual syncs
            });

            if (result.data?.success) {
                toast.success(`סנכרון הושלם: ${result.data.stats?.created || 0} נוצרו, ${result.data.stats?.updated || 0} עודכנו`);
            } else {
                toast.error("סנכרון נכשל: " + (result.data?.error || "שגיאה לא ידועה"));
            }

            loadData();
        } catch (error) {
            console.error("Sync error:", error);
            toast.error("שגיאה בסנכרון: " + error.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleCatchUpDecember = async () => {
        setIsSyncing(true);
        try {
            toast.loading('🚀 מתחיל סנכרון של 22 ימים בדצמבר...', { duration: 2000 });

            const result = await base44.functions.invoke('catchUpSync', {
                from_date: '2024-12-09',
                to_date: '2024-12-30'
            });

            if (result.data?.success || result.data?.started) {
                toast.success(`✅ ${result.data.message || 'הסנכרון התחיל!'}\n\n⏳ זה ייקח כ-5 דקות. רענן את הדף בעוד כמה דקות לראות את התוצאות.`, {
                    duration: 10000
                });
                
                // Auto-refresh after 2 minutes
                setTimeout(() => {
                    loadData();
                    toast.info('מרענן נתונים...', { duration: 1000 });
                }, 120000);
            } else {
                toast.error('סנכרון דצמבר נכשל: ' + (result.data?.error || 'שגיאה'));
            }

            loadData();
        } catch (error) {
            console.error('Catch-up error:', error);
            toast.error('שגיאה בסנכרון: ' + error.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleQuickSync = async (days) => {
        setIsSyncing(true);
        try {
            const fromDatetime = subDays(new Date(), days).toISOString();
            const toDatetime = new Date().toISOString();

            toast.info(`מסנכרן ${days} ימים אחרונים...`, { duration: 2000 });

            const result = await base44.functions.invoke('runLinetSync', {
                from_datetime: fromDatetime,
                to_datetime: toDatetime,
                trigger_type: "MANUAL",
                update_last_successful: true
            });

            if (result.data?.success) {
                toast.success(`סנכרון הושלם: ${result.data.stats?.created || 0} נוצרו, ${result.data.stats?.updated || 0} עודכנו`);
            } else {
                toast.error("סנכרון נכשל: " + (result.data?.error || "שגיאה לא ידועה"));
            }

            loadData();
        } catch (error) {
            console.error("Sync error:", error);
            toast.error("שגיאה בסנכרון: " + error.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'SUCCESS':
                return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />הצלחה</Badge>;
            case 'FAILED':
                return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />נכשל</Badge>;
            case 'PARTIAL':
                return <Badge className="bg-yellow-100 text-yellow-800"><AlertCircle className="w-3 h-3 mr-1" />חלקי</Badge>;
            case 'RUNNING':
                return <Badge className="bg-blue-100 text-blue-800"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />רץ</Badge>;
            default:
                return <Badge variant="outline">{status || 'לא ידוע'}</Badge>;
        }
    };

    const getTriggerLabel = (trigger) => {
        switch (trigger) {
            case 'HOURLY': return '⏰ שעתי';
            case 'NIGHTLY': return '🌙 לילה';
            case 'MANUAL': return '👆 ידני';
            default: return trigger || '-';
        }
    };

    if (!isManager) {
        return (
            <div className="p-6 text-center">
                <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
                <p className="text-gray-600 mt-2">דף זה זמין למנהלים בלבד</p>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <Database className="w-8 h-8 text-indigo-600" />
                        ניהול סנכרון לינט
                    </h1>
                    <p className="text-gray-600 mt-1">מעקב ובקרה על סנכרון נתונים מלינט</p>
                </div>
                <Button 
                    onClick={loadData} 
                    variant="outline" 
                    disabled={isLoading}
                    className="gap-2"
                >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    רענן
                </Button>
            </div>

            {/* Status Card */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-indigo-700">
                        <TrendingUp className="w-5 h-5" />
                        סטטוס סנכרון נוכחי
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {metadata ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-4 bg-white rounded-lg border">
                                <p className="text-sm text-gray-600 mb-1">סטטוס אחרון</p>
                                {getStatusBadge(metadata.status)}
                            </div>
                            <div className="p-4 bg-white rounded-lg border">
                                <p className="text-sm text-gray-600 mb-1">סנכרון מוצלח אחרון</p>
                                <p className="font-semibold text-sm">
                                    {metadata.last_successful_sync 
                                        ? format(new Date(metadata.last_successful_sync), 'dd/MM/yyyy HH:mm')
                                        : 'לא בוצע עדיין'}
                                </p>
                            </div>
                            <div className="p-4 bg-white rounded-lg border">
                                <p className="text-sm text-gray-600 mb-1">ניסיון אחרון</p>
                                <p className="font-semibold text-sm">
                                    {metadata.last_attempt 
                                        ? format(new Date(metadata.last_attempt), 'dd/MM/yyyy HH:mm')
                                        : '-'}
                                </p>
                            </div>
                            <div className="p-4 bg-white rounded-lg border">
                                <p className="text-sm text-gray-600 mb-1">כישלונות רצופים</p>
                                <p className={`font-bold text-lg ${metadata.consecutive_failures > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                    {metadata.consecutive_failures || 0}
                                </p>
                            </div>
                            {metadata.last_error_message && (
                                <div className="col-span-full p-4 bg-red-50 rounded-lg border border-red-200">
                                    <p className="text-sm text-red-600 font-medium">שגיאה אחרונה:</p>
                                    <p className="text-sm text-red-800">{metadata.last_error_message}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            <Database className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>לא נמצאו נתוני סנכרון</p>
                            <p className="text-sm">הרץ סנכרון ראשון כדי להתחיל</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Quick Sync Buttons */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-700">
                        <Play className="w-5 h-5" />
                        סנכרון מהיר
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-3">
                        <Button 
                            onClick={handleCatchUpDecember}
                            disabled={isSyncing}
                            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold"
                        >
                            {isSyncing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                            🎯 סנכרן דצמבר מלא (9-30)
                        </Button>
                        <Button 
                            onClick={() => handleQuickSync(1)}
                            disabled={isSyncing}
                            className="bg-green-600 hover:bg-green-700 text-white"
                        >
                            {isSyncing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                            היום בלבד
                        </Button>
                        <Button 
                            onClick={() => handleQuickSync(3)}
                            disabled={isSyncing}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            3 ימים אחרונים
                        </Button>
                        <Button 
                            onClick={() => handleQuickSync(7)}
                            disabled={isSyncing}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                            שבוע אחרון
                        </Button>
                        <Button 
                            onClick={() => handleQuickSync(30)}
                            disabled={isSyncing}
                            variant="outline"
                        >
                            30 ימים אחרונים
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Manual Sync */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-orange-700">
                        <Calendar className="w-5 h-5" />
                        סנכרון ידני - בחירת טווח תאריכים
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                        <div>
                            <Label className="text-sm font-medium mb-1 block">מתאריך</Label>
                            <Input
                                type="date"
                                value={manualDateFrom}
                                onChange={(e) => setManualDateFrom(e.target.value)}
                                className="bg-white"
                            />
                        </div>
                        <div>
                            <Label className="text-sm font-medium mb-1 block">עד תאריך</Label>
                            <Input
                                type="date"
                                value={manualDateTo}
                                onChange={(e) => setManualDateTo(e.target.value)}
                                className="bg-white"
                            />
                        </div>
                        <Button 
                            onClick={handleManualSync}
                            disabled={isSyncing}
                            className="bg-orange-600 hover:bg-orange-700 text-white"
                        >
                            {isSyncing ? (
                                <>
                                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                    מסנכרן...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4 mr-2" />
                                    סנכרן עכשיו
                                </>
                            )}
                        </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">
                        💡 סנכרון ידני לא מעדכן את "סנכרון מוצלח אחרון" - מתאים לבדיקות או יישור קו על תקופה ספציפית
                    </p>
                </CardContent>
            </Card>

            {/* Sync Logs */}
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-gray-700">
                        <History className="w-5 h-5" />
                        היסטוריית סנכרונים ({logs.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {logs.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>אין היסטוריית סנכרונים</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>התחלה</TableHead>
                                        <TableHead>סיום</TableHead>
                                        <TableHead>טריגר</TableHead>
                                        <TableHead>טווח תאריכים</TableHead>
                                        <TableHead>סטטוס</TableHead>
                                        <TableHead className="text-center">נשלפו</TableHead>
                                        <TableHead className="text-center">נוצרו</TableHead>
                                        <TableHead className="text-center">עודכנו</TableHead>
                                        <TableHead>שגיאה</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {logs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-sm">
                                                {log.run_started_at 
                                                    ? format(new Date(log.run_started_at), 'dd/MM HH:mm')
                                                    : '-'}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {log.run_finished_at 
                                                    ? format(new Date(log.run_finished_at), 'HH:mm:ss')
                                                    : '-'}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {getTriggerLabel(log.trigger_type)}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-600">
                                                {log.from_datetime && log.to_datetime ? (
                                                    <div>
                                                        <div>{format(new Date(log.from_datetime), 'dd/MM')}</div>
                                                        <div className="text-gray-400">עד</div>
                                                        <div>{format(new Date(log.to_datetime), 'dd/MM')}</div>
                                                    </div>
                                                ) : '-'}
                                            </TableCell>
                                            <TableCell>
                                                {getStatusBadge(log.status)}
                                            </TableCell>
                                            <TableCell className="text-center font-medium">
                                                {log.records_fetched || 0}
                                            </TableCell>
                                            <TableCell className="text-center text-green-600 font-medium">
                                                {log.records_created || 0}
                                            </TableCell>
                                            <TableCell className="text-center text-blue-600 font-medium">
                                                {log.records_updated || 0}
                                            </TableCell>
                                            <TableCell className="text-sm text-red-600 max-w-[200px] truncate">
                                                {log.error_message || '-'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Schedule Info */}
            <Card className="glass-card border-0 bg-indigo-50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-indigo-700">
                        <Clock className="w-5 h-5" />
                        לוח זמנים אוטומטי
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="p-4 bg-white rounded-lg border border-indigo-200">
                            <h4 className="font-semibold text-indigo-800 mb-2">⏰ סנכרון שעתי</h4>
                            <p className="text-sm text-gray-700">כל שעה עגולה בין 09:00 ל-22:00</p>
                            <p className="text-xs text-gray-500 mt-1">מסנכרן שינויים מהסנכרון המוצלח האחרון</p>
                        </div>
                        <div className="p-4 bg-white rounded-lg border border-indigo-200">
                            <h4 className="font-semibold text-indigo-800 mb-2">🌙 סנכרון לילה</h4>
                            <p className="text-sm text-gray-700">כל לילה בשעה 02:30</p>
                            <p className="text-xs text-gray-500 mt-1">מסנכרן 3 ימים אחורה - יישור קו וסגירת פערים</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}