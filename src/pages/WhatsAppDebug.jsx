import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
    CheckCircle, 
    XCircle, 
    AlertTriangle, 
    Info, 
    RefreshCw, 
    MessageSquare,
    Zap,
    Globe,
    Key,
    Activity,
    FileText,
    Loader2
} from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function WhatsAppDebug() {
    const [results, setResults] = useState(null);
    const [isChecking, setIsChecking] = useState(false);
    const [lastCheck, setLastCheck] = useState(null);

    useEffect(() => {
        runCheck();
    }, []);

    const runCheck = async () => {
        setIsChecking(true);
        try {
            const { data } = await base44.functions.invoke('systemCheck');
            setResults(data.results);
            setLastCheck(new Date());
        } catch (error) {
            console.error('Error running system check:', error);
        } finally {
            setIsChecking(false);
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'ok':
                return <CheckCircle className="w-6 h-6 text-green-600" />;
            case 'error':
                return <XCircle className="w-6 h-6 text-red-600" />;
            case 'warning':
                return <AlertTriangle className="w-6 h-6 text-yellow-600" />;
            default:
                return <Info className="w-6 h-6 text-blue-600" />;
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'ok':
                return 'bg-green-50 border-green-200';
            case 'error':
                return 'bg-red-50 border-red-200';
            case 'warning':
                return 'bg-yellow-50 border-yellow-200';
            default:
                return 'bg-blue-50 border-blue-200';
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'ok':
                return <Badge className="bg-green-100 text-green-800">✅ תקין</Badge>;
            case 'error':
                return <Badge className="bg-red-100 text-red-800">❌ שגיאה</Badge>;
            case 'warning':
                return <Badge className="bg-yellow-100 text-yellow-800">⚠️ אזהרה</Badge>;
            default:
                return <Badge className="bg-blue-100 text-blue-800">ℹ️ מידע</Badge>;
        }
    };

    const checkIcons = {
        provider: MessageSquare,
        apiKey: Key,
        botit: Zap,
        webhook: Globe,
        webhookActivity: Activity,
        activities: FileText,
        tickets: FileText
    };

    return (
        <div className="p-6 space-y-6 bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">🔧 מערכת דיבאג WhatsApp</h1>
                    <p className="text-gray-600">
                        בדיקה אוטומטית של כל המערכת - {lastCheck && `עודכן: ${lastCheck.toLocaleTimeString('he-IL')}`}
                    </p>
                </div>
                <Button 
                    onClick={runCheck} 
                    disabled={isChecking}
                    className="bg-blue-600 hover:bg-blue-700"
                >
                    {isChecking ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            בודק...
                        </>
                    ) : (
                        <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            בדוק שוב
                        </>
                    )}
                </Button>
            </div>

            {/* Results */}
            {results && (
                <div className="grid gap-4">
                    {Object.entries(results.checks).map(([key, check]) => {
                        const Icon = checkIcons[key] || Info;
                        
                        return (
                            <Card key={key} className={`border-2 ${getStatusColor(check.status)}`}>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Icon className="w-6 h-6 text-gray-700" />
                                            <CardTitle className="text-xl">
                                                {key === 'provider' && 'הגדרות ספק'}
                                                {key === 'apiKey' && 'מפתח API'}
                                                {key === 'botit' && 'חיבור ל-Bot.it'}
                                                {key === 'webhook' && 'Webhook Configuration'}
                                                {key === 'webhookActivity' && 'פעילות Webhook'}
                                                {key === 'activities' && 'פעילויות אחרונות'}
                                                {key === 'tickets' && 'טיקטים פתוחים'}
                                                {key === 'error' && 'שגיאה כללית'}
                                            </CardTitle>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {getStatusBadge(check.status)}
                                            {getStatusIcon(check.status)}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-gray-800 font-medium mb-4">{check.message}</p>
                                    
                                    {check.details && (
                                        <div className="bg-white rounded-lg p-4 border">
                                            <h4 className="font-semibold text-sm text-gray-700 mb-2">פרטים:</h4>
                                            <pre className="text-xs text-gray-600 whitespace-pre-wrap">
                                                {JSON.stringify(check.details, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Summary */}
            {results && (
                <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200">
                    <CardHeader>
                        <CardTitle className="text-2xl">📊 סיכום</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-center p-4 bg-white rounded-lg">
                                <div className="text-3xl font-bold text-green-600">
                                    {Object.values(results.checks).filter(c => c.status === 'ok').length}
                                </div>
                                <div className="text-sm text-gray-600">תקין</div>
                            </div>
                            <div className="text-center p-4 bg-white rounded-lg">
                                <div className="text-3xl font-bold text-red-600">
                                    {Object.values(results.checks).filter(c => c.status === 'error').length}
                                </div>
                                <div className="text-sm text-gray-600">שגיאות</div>
                            </div>
                            <div className="text-center p-4 bg-white rounded-lg">
                                <div className="text-3xl font-bold text-yellow-600">
                                    {Object.values(results.checks).filter(c => c.status === 'warning').length}
                                </div>
                                <div className="text-sm text-gray-600">אזהרות</div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Instructions */}
            <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200">
                <CardHeader>
                    <CardTitle>💡 הוראות תיקון</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex items-start gap-2">
                        <Badge className="bg-red-100 text-red-800">❌ שגיאה</Badge>
                        <div>
                            <p className="font-semibold">אם רואה "❌ שגיאה" ב-Provider:</p>
                            <p className="text-sm text-gray-600">עבור ל-"ספקי וואטסאפ" והפעל ספק</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Badge className="bg-red-100 text-red-800">❌ שגיאה</Badge>
                        <div>
                            <p className="font-semibold">אם רואה "❌ שגיאה" ב-API Key:</p>
                            <p className="text-sm text-gray-600">הוסף את ה-API Key בהגדרות הספק</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Badge className="bg-red-100 text-red-800">❌ שגיאה</Badge>
                        <div>
                            <p className="font-semibold">אם רואה "❌ שגיאה" ב-Bot.it:</p>
                            <p className="text-sm text-gray-600">בדוק שה-API Key תקין ושהמספר פעיל</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Badge className="bg-yellow-100 text-yellow-800">⚠️ אזהרה</Badge>
                        <div>
                            <p className="font-semibold">אם רואה "⚠️ אזהרה" ב-Webhook Activity:</p>
                            <p className="text-sm text-gray-600">ודא שה-Webhook מוגדר ב-Bot.it</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}