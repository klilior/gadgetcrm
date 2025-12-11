import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import UnauthorizedRedirect from "../components/UnauthorizedRedirect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Users, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";

export default function CustomerSync() {
    const { currentUser } = useUser();
    const [isSyncing, setIsSyncing] = useState(false);
    const [result, setResult] = useState(null);

    const isManager = currentUser?.role === 'מנהל';

    const handleSync = async (mode) => {
        if (!confirm(`האם לסנכרן לקוחות ממצב: ${mode === 'recent' ? 'חוזים אחרונים' : 'כל הלקוחות הקיימים'}?`)) {
            return;
        }

        setIsSyncing(true);
        setResult(null);

        try {
            const response = await base44.functions.invoke('manualCustomerSync', {
                mode,
                force_refresh: true
            });

            if (response.data.success) {
                setResult({
                    success: true,
                    message: response.data.sync_result.message,
                    stats: response.data.sync_result.stats,
                    total_ids: response.data.total_ids
                });
            } else {
                throw new Error(response.data.error || 'Sync failed');
            }

        } catch (error) {
            console.error('Sync error:', error);
            setResult({
                success: false,
                error: error.message
            });
        } finally {
            setIsSyncing(false);
        }
    };

    if (!isManager) {
        return <UnauthorizedRedirect currentUser={currentUser} />;
    }

    return (
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                    <Users className="w-8 h-8 text-indigo-600" />
                    סנכרון פרטי לקוחות מלינט
                </h1>
                <p className="text-gray-600 mt-1">
                    משוך טלפונים ודוא״לים של לקוחות מ-Linet API
                </p>
            </div>

            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>מידע</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert>
                        <AlertTriangle className="w-4 h-4" />
                        <AlertDescription>
                            הסנכרון מושך פרטי קשר מעודכנים (טלפון, דוא״ל, כתובת) מלינט עבור הלקוחות במערכת.
                            הנתונים יוצגו בממשקי ניהול הקווים ובדשבורדים.
                        </AlertDescription>
                    </Alert>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                            <div>
                                <p className="font-medium">סנכרון לקוחות מחוזים אחרונים</p>
                                <p className="text-sm text-gray-600">מושך פרטי קשר עבור כל הלקוחות עם חוזי קווים</p>
                            </div>
                            <Button
                                onClick={() => handleSync('recent')}
                                disabled={isSyncing}
                                className="bg-indigo-600 hover:bg-indigo-700"
                            >
                                {isSyncing ? (
                                    <><RefreshCw className="w-4 h-4 ml-2 animate-spin" /> מסנכרן...</>
                                ) : (
                                    <><Users className="w-4 h-4 ml-2" /> סנכרן חוזים</>
                                )}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                            <div>
                                <p className="font-medium">רענון כל הלקוחות</p>
                                <p className="text-sm text-gray-600">מעדכן מחדש את כל רשומות הלקוחות במערכת</p>
                            </div>
                            <Button
                                onClick={() => handleSync('all_existing')}
                                disabled={isSyncing}
                                variant="outline"
                            >
                                {isSyncing ? (
                                    <><RefreshCw className="w-4 h-4 ml-2 animate-spin" /> מסנכרן...</>
                                ) : (
                                    <><RefreshCw className="w-4 h-4 ml-2" /> רענן הכל</>
                                )}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {result && (
                <Card className={`border-0 ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            {result.success ? (
                                <><CheckCircle className="w-5 h-5 text-green-600" /> הצלחה</>
                            ) : (
                                <><AlertTriangle className="w-5 h-5 text-red-600" /> שגיאה</>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {result.success ? (
                            <div className="space-y-2">
                                <p className="font-medium">{result.message}</p>
                                {result.stats && (
                                    <div className="grid grid-cols-3 gap-4 mt-4">
                                        <div className="p-3 bg-white rounded-lg">
                                            <p className="text-xs text-gray-600">נבדקו</p>
                                            <p className="text-2xl font-bold">{result.total_ids}</p>
                                        </div>
                                        <div className="p-3 bg-white rounded-lg">
                                            <p className="text-xs text-gray-600">נוצרו</p>
                                            <p className="text-2xl font-bold text-green-600">{result.stats.created}</p>
                                        </div>
                                        <div className="p-3 bg-white rounded-lg">
                                            <p className="text-xs text-gray-600">עודכנו</p>
                                            <p className="text-2xl font-bold text-blue-600">{result.stats.updated}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-red-600">{result.error}</p>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}