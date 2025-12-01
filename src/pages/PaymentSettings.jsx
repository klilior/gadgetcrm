import React, { useState, useEffect } from "react";
import { PaymentSettings } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { CreditCard, FileText, Settings, Save, CheckCircle, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "../components/UserAuth";
import { toast } from "sonner";

export default function PaymentSettingsPage() {
    const [settings, setSettings] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const { currentUser } = useUser();
    
    // Z-Credit Settings
    const [zcreditMode, setZcreditMode] = useState('sandbox');
    const [zcreditTerminal, setZcreditTerminal] = useState('');
    const [zcreditPassword, setZcreditPassword] = useState('');
    const [zcreditReturnUrl, setZcreditReturnUrl] = useState('');
    const [zcreditFailUrl, setZcreditFailUrl] = useState('');
    const [zcreditDefaultFlow, setZcreditDefaultFlow] = useState('webcheckout');
    
    // Linet Settings
    const [linetBaseUrl, setLinetBaseUrl] = useState('https://tax.linet.app');
    const [linetUser, setLinetUser] = useState('');
    const [linetApiKey, setLinetApiKey] = useState('');
    const [linetLoginCompany, setLinetLoginCompany] = useState('');
    const [linetDefaultDocType, setLinetDefaultDocType] = useState('invoice_receipt');
    
    // General Settings
    const [enableInstallments, setEnableInstallments] = useState(true);
    const [maxPayments, setMaxPayments] = useState(12);
    
    const [showPasswords, setShowPasswords] = useState(false);

    const isManager = currentUser?.role === "מנהל";

    useEffect(() => {
        if (isManager) {
            loadSettings();
        } else {
            setIsLoading(false);
        }
    }, [isManager]);

    const loadSettings = async () => {
        try {
            setIsLoading(true);
            const allSettings = await PaymentSettings.list();
            setSettings(allSettings);
            
            // Z-Credit
            const zMode = allSettings.find(s => s.setting_key === 'zcredit_mode');
            const zTerminal = allSettings.find(s => s.setting_key === 'zcredit_terminal');
            const zPassword = allSettings.find(s => s.setting_key === 'zcredit_password');
            const zReturnUrl = allSettings.find(s => s.setting_key === 'zcredit_return_url');
            const zFailUrl = allSettings.find(s => s.setting_key === 'zcredit_fail_url');
            const zFlow = allSettings.find(s => s.setting_key === 'zcredit_default_flow');
            
            if (zMode) setZcreditMode(zMode.setting_value);
            if (zTerminal) setZcreditTerminal(zTerminal.setting_value);
            if (zPassword) setZcreditPassword(zPassword.setting_value);
            if (zReturnUrl) setZcreditReturnUrl(zReturnUrl.setting_value);
            if (zFailUrl) setZcreditFailUrl(zFailUrl.setting_value);
            if (zFlow) setZcreditDefaultFlow(zFlow.setting_value);
            
            // Linet
            const lBaseUrl = allSettings.find(s => s.setting_key === 'linet_base_url');
            const lUser = allSettings.find(s => s.setting_key === 'linet_user');
            const lApiKey = allSettings.find(s => s.setting_key === 'linet_api_key');
            const lCompany = allSettings.find(s => s.setting_key === 'linet_login_company');
            const lDocType = allSettings.find(s => s.setting_key === 'linet_default_doc_type');
            
            if (lBaseUrl) setLinetBaseUrl(lBaseUrl.setting_value);
            if (lUser) setLinetUser(lUser.setting_value);
            if (lApiKey) setLinetApiKey(lApiKey.setting_value);
            if (lCompany) setLinetLoginCompany(lCompany.setting_value);
            if (lDocType) setLinetDefaultDocType(lDocType.setting_value);
            
            // General
            const eInstallments = allSettings.find(s => s.setting_key === 'enable_installments');
            const mPayments = allSettings.find(s => s.setting_key === 'max_payments');
            
            if (eInstallments) setEnableInstallments(eInstallments.setting_value === 'true');
            if (mPayments) setMaxPayments(parseInt(mPayments.setting_value) || 12);
            
        } catch (error) {
            console.error("Error loading settings:", error);
            toast.error("שגיאה בטעינת הגדרות");
        } finally {
            setIsLoading(false);
        }
    };

    const saveSettings = async () => {
        try {
            setIsSaving(true);
            
            const settingsToSave = [
                // Z-Credit
                { key: 'zcredit_mode', value: zcreditMode, group: 'zcredit', desc: 'מצב Z-Credit (sandbox/live)' },
                { key: 'zcredit_terminal', value: zcreditTerminal, group: 'zcredit', desc: 'מספר מסוף Z-Credit', encrypted: true },
                { key: 'zcredit_password', value: zcreditPassword, group: 'zcredit', desc: 'סיסמת Z-Credit', encrypted: true },
                { key: 'zcredit_return_url', value: zcreditReturnUrl, group: 'zcredit', desc: 'כתובת חזרה מתשלום מוצלח' },
                { key: 'zcredit_fail_url', value: zcreditFailUrl, group: 'zcredit', desc: 'כתובת חזרה מתשלום כושל' },
                { key: 'zcredit_default_flow', value: zcreditDefaultFlow, group: 'zcredit', desc: 'זרימת תשלום ברירת מחדל' },
                
                // Linet
                { key: 'linet_base_url', value: linetBaseUrl, group: 'linet', desc: 'כתובת בסיס Linet' },
                { key: 'linet_user', value: linetUser, group: 'linet', desc: 'משתמש Linet', encrypted: true },
                { key: 'linet_api_key', value: linetApiKey, group: 'linet', desc: 'מפתח API של Linet', encrypted: true },
                { key: 'linet_login_company', value: linetLoginCompany, group: 'linet', desc: 'חברה ב-Linet', encrypted: true },
                { key: 'linet_default_doc_type', value: linetDefaultDocType, group: 'linet', desc: 'סוג מסמך ברירת מחדל' },
                
                // General
                { key: 'enable_installments', value: enableInstallments.toString(), group: 'general', desc: 'אפשר תשלומים' },
                { key: 'max_payments', value: maxPayments.toString(), group: 'general', desc: 'מספר תשלומים מקסימלי' },
            ];
            
            for (const setting of settingsToSave) {
                const existing = settings.find(s => s.setting_key === setting.key);
                
                if (existing) {
                    await PaymentSettings.update(existing.id, {
                        setting_value: setting.value,
                        is_encrypted: setting.encrypted || false,
                        description: setting.desc
                    });
                } else {
                    await PaymentSettings.create({
                        setting_key: setting.key,
                        setting_value: setting.value,
                        setting_group: setting.group,
                        is_encrypted: setting.encrypted || false,
                        description: setting.desc
                    });
                }
            }
            
            toast.success("ההגדרות נשמרו בהצלחה!", {
                icon: <CheckCircle className="w-4 h-4" />
            });
            
            loadSettings();
            
        } catch (error) {
            console.error("Error saving settings:", error);
            toast.error("שגיאה בשמירת הגדרות");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isManager) {
        return (
            <div className="p-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
                <Card className="glass-card border-0">
                    <CardContent className="p-8 text-center">
                        <Settings className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <h2 className="text-xl font-bold text-gray-900 mb-2">גישה מוגבלת</h2>
                        <p className="text-gray-600">דף הגדרות תשלום זמין למנהלים בלבד</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="p-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
                <h1 className="text-3xl font-bold mb-6" style={{ color: '#1C1C1E' }}>הגדרות תשלום</h1>
                <div className="glass-card p-6 animate-pulse h-96"></div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold" style={{ color: '#1C1C1E' }}>הגדרות תשלום</h1>
                    <p className="text-sm text-gray-600 mt-1">ניהול הגדרות Z-Credit ו-Linet</p>
                </div>
                <Button 
                    onClick={saveSettings} 
                    disabled={isSaving}
                    className="glass-button"
                    style={{ background: '#7D0F82', color: 'white' }}
                    size="lg"
                >
                    {isSaving ? (
                        <>
                            <span className="animate-spin mr-2">⏳</span>
                            שומר...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4 ml-2" />
                            שמור הגדרות
                        </>
                    )}
                </Button>
            </div>

            <Tabs defaultValue="zcredit" className="w-full">
                <TabsList className="glass-card p-2 rounded-2xl grid grid-cols-3 gap-1">
                    <TabsTrigger value="zcredit" className="rounded-xl data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                        <CreditCard className="w-4 h-4 mr-2" />
                        Z-Credit
                    </TabsTrigger>
                    <TabsTrigger value="linet" className="rounded-xl data-[state=active]:bg-purple-500 data-[state=active]:text-white">
                        <FileText className="w-4 h-4 mr-2" />
                        Linet
                    </TabsTrigger>
                    <TabsTrigger value="general" className="rounded-xl data-[state=active]:bg-green-500 data-[state=active]:text-white">
                        <Settings className="w-4 h-4 mr-2" />
                        כללי
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="zcredit" className="space-y-6 mt-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2" style={{ color: '#7D0F82' }}>
                                <CreditCard className="w-5 h-5" />
                                הגדרות Z-Credit
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                הגדר את פרטי ההתחברות לשער התשלום Z-Credit
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Mode */}
                            <div>
                                <Label className="flex items-center gap-2">
                                    מצב סביבה
                                    <Badge variant={zcreditMode === 'live' ? 'default' : 'outline'}>
                                        {zcreditMode === 'live' ? 'פרודקשן' : 'בדיקות'}
                                    </Badge>
                                </Label>
                                <Select value={zcreditMode} onValueChange={setZcreditMode}>
                                    <SelectTrigger className="glass-button mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="sandbox">Sandbox (בדיקות)</SelectItem>
                                        <SelectItem value="live">Live (פרודקשן)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-gray-500 mt-1">
                                    ⚠️ החלף ל-Live רק אחרי בדיקות מלאות
                                </p>
                            </div>

                            {/* Terminal */}
                            <div>
                                <Label>מספר מסוף (Terminal Number) *</Label>
                                <Input
                                    value={zcreditTerminal}
                                    onChange={(e) => setZcreditTerminal(e.target.value)}
                                    placeholder="1234567"
                                    className="glass-button mt-1"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    מספר המסוף שקיבלת מ-Z-Credit
                                </p>
                            </div>

                            {/* Password */}
                            <div>
                                <Label className="flex items-center justify-between">
                                    <span>סיסמה (Password) *</span>
                                    <button
                                        type="button"
                                        onClick={() => setShowPasswords(!showPasswords)}
                                        className="text-xs text-blue-600 flex items-center gap-1"
                                    >
                                        {showPasswords ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                        {showPasswords ? 'הסתר' : 'הצג'}
                                    </button>
                                </Label>
                                <Input
                                    type={showPasswords ? "text" : "password"}
                                    value={zcreditPassword}
                                    onChange={(e) => setZcreditPassword(e.target.value)}
                                    placeholder="********"
                                    className="glass-button mt-1 font-mono"
                                />
                            </div>

                            {/* Flow */}
                            <div>
                                <Label>זרימת תשלום ברירת מחדל</Label>
                                <Select value={zcreditDefaultFlow} onValueChange={setZcreditDefaultFlow}>
                                    <SelectTrigger className="glass-button mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="webcheckout">WebCheckout (דף מאוחסן - מומלץ)</SelectItem>
                                        <SelectItem value="gateway">Gateway (שרת לשרת)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-gray-500 mt-1">
                                    WebCheckout מומלץ - מפעיל 3DS אוטומטית
                                </p>
                            </div>

                            {/* Return URL */}
                            <div>
                                <Label>כתובת חזרה מתשלום מוצלח</Label>
                                <Input
                                    value={zcreditReturnUrl}
                                    onChange={(e) => setZcreditReturnUrl(e.target.value)}
                                    placeholder="https://app.gadget-team.co.il/payments/success"
                                    className="glass-button mt-1"
                                    dir="ltr"
                                />
                            </div>

                            {/* Fail URL */}
                            <div>
                                <Label>כתובת חזרה מתשלום כושל</Label>
                                <Input
                                    value={zcreditFailUrl}
                                    onChange={(e) => setZcreditFailUrl(e.target.value)}
                                    placeholder="https://app.gadget-team.co.il/payments/fail"
                                    className="glass-button mt-1"
                                    dir="ltr"
                                />
                            </div>

                            {/* Info Box */}
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                                <p className="text-sm font-semibold text-blue-900 mb-2">📘 איך להשיג את הפרטים?</p>
                                <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                                    <li>היכנס ל-<a href="https://zcredit.co.il" target="_blank" className="underline">מסוף Z-Credit</a></li>
                                    <li>לך ל-"הגדרות" → "API"</li>
                                    <li>העתק את מספר המסוף והסיסמה</li>
                                    <li>הגדר Webhook URLs לקבלת עדכונים אוטומטיים</li>
                                </ol>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="linet" className="space-y-6 mt-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2" style={{ color: '#7D0F82' }}>
                                <FileText className="w-5 h-5" />
                                הגדרות Linet
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                הגדר את פרטי ההתחברות למערכת הנהלת החשבונות Linet
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Base URL */}
                            <div>
                                <Label>כתובת בסיס (Base URL)</Label>
                                <Input
                                    value={linetBaseUrl}
                                    onChange={(e) => setLinetBaseUrl(e.target.value)}
                                    placeholder="https://tax.linet.app"
                                    className="glass-button mt-1"
                                    dir="ltr"
                                />
                            </div>

                            {/* User */}
                            <div>
                                <Label>משתמש (User) *</Label>
                                <Input
                                    value={linetUser}
                                    onChange={(e) => setLinetUser(e.target.value)}
                                    placeholder="username"
                                    className="glass-button mt-1"
                                />
                            </div>

                            {/* API Key */}
                            <div>
                                <Label className="flex items-center justify-between">
                                    <span>מפתח API (API Key) *</span>
                                    <button
                                        type="button"
                                        onClick={() => setShowPasswords(!showPasswords)}
                                        className="text-xs text-blue-600 flex items-center gap-1"
                                    >
                                        {showPasswords ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                        {showPasswords ? 'הסתר' : 'הצג'}
                                    </button>
                                </Label>
                                <Input
                                    type={showPasswords ? "text" : "password"}
                                    value={linetApiKey}
                                    onChange={(e) => setLinetApiKey(e.target.value)}
                                    placeholder="********"
                                    className="glass-button mt-1 font-mono"
                                />
                            </div>

                            {/* Login Company */}
                            <div>
                                <Label>חברה (Login Company) *</Label>
                                <Input
                                    value={linetLoginCompany}
                                    onChange={(e) => setLinetLoginCompany(e.target.value)}
                                    placeholder="company_id"
                                    className="glass-button mt-1"
                                />
                            </div>

                            {/* Document Type */}
                            <div>
                                <Label>סוג מסמך ברירת מחדל</Label>
                                <Select value={linetDefaultDocType} onValueChange={setLinetDefaultDocType}>
                                    <SelectTrigger className="glass-button mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="invoice_receipt">חשבונית מס-קבלה</SelectItem>
                                        <SelectItem value="invoice">חשבונית מס</SelectItem>
                                        <SelectItem value="receipt">קבלה</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Info Box */}
                            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                                <p className="text-sm font-semibold text-purple-900 mb-2">📘 איך להשיג את הפרטים?</p>
                                <ol className="text-xs text-purple-700 space-y-1 list-decimal list-inside">
                                    <li>היכנס ל-<a href="https://tax.linet.app" target="_blank" className="underline">Linet</a></li>
                                    <li>לך ל-"הגדרות" → "API"</li>
                                    <li>צור API Key חדש</li>
                                    <li>העתק את פרטי המשתמש, API Key ומזהה החברה</li>
                                </ol>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="general" className="space-y-6 mt-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2" style={{ color: '#7D0F82' }}>
                                <Settings className="w-5 h-5" />
                                הגדרות כלליות
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                הגדרות נוספות לניהול תשלומים
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Enable Installments */}
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                <div>
                                    <Label className="font-semibold">אפשר תשלומים</Label>
                                    <p className="text-xs text-gray-600 mt-1">
                                        אפשר ללקוחות לשלם במספר תשלומים
                                    </p>
                                </div>
                                <Switch
                                    checked={enableInstallments}
                                    onCheckedChange={setEnableInstallments}
                                />
                            </div>

                            {/* Max Payments */}
                            {enableInstallments && (
                                <div>
                                    <Label>מספר תשלומים מקסימלי</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        max="36"
                                        value={maxPayments}
                                        onChange={(e) => setMaxPayments(parseInt(e.target.value) || 12)}
                                        className="glass-button mt-1"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        ברירת מחדל: 12 תשלומים
                                    </p>
                                </div>
                            )}

                            {/* Status Summary */}
                            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                <p className="text-sm font-semibold text-green-900 mb-3">✅ סטטוס מערכת</p>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-green-700">Z-Credit:</span>
                                        <Badge variant={zcreditTerminal && zcreditPassword ? 'default' : 'outline'}>
                                            {zcreditTerminal && zcreditPassword ? 'מוגדר' : 'לא מוגדר'}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-green-700">Linet:</span>
                                        <Badge variant={linetUser && linetApiKey && linetLoginCompany ? 'default' : 'outline'}>
                                            {linetUser && linetApiKey && linetLoginCompany ? 'מוגדר' : 'לא מוגדר'}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-green-700">מצב:</span>
                                        <Badge variant={zcreditMode === 'live' ? 'destructive' : 'secondary'}>
                                            {zcreditMode === 'live' ? 'פרודקשן' : 'בדיקות'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}