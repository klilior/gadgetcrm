import React, { useState, useEffect } from "react";
import { Settings as SettingsEntity, PredefinedResponse, RepairVendor, WebhookLog } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Settings as SettingsIcon, Save, Plus, Trash2, MessageCircle, Truck, ShoppingCart, Edit, ToggleLeft, ToggleRight, CheckCircle, Bell, Play, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import WhatsAppStatusAlert from "../components/WhatsAppStatusAlert";
import { useUser } from "../components/UserAuth";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { importerReminders } from "@/functions/importerReminders";

export default function SettingsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const currentTab = searchParams.get('tab') || 'whatsapp';

    const [settings, setSettings] = useState([]);
    const [predefinedResponses, setPredefinedResponses] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [newSetting, setNewSetting] = useState({ name: "", value: "", notes: "" });
    const [newResponse, setNewResponse] = useState({ response_name: "", content: "", channels: ["whatsapp"] });
    const [isLoading, setIsLoading] = useState(true);
    const [vendorError, setVendorError] = useState("");
    const [vendorSuccess, setVendorSuccess] = useState("");

    const [wooCommerceSettings, setWooCommerceSettings] = useState({
        WOOCOMMERCE_CONSUMER_KEY: "",
        WOOCOMMERCE_CONSUMER_SECRET: "",
        WOOCOMMERCE_SITE_URL: ""
    });

    const [linetSettings, setLinetSettings] = useState({
        LINET_LOGIN_ID: "",
        LINET_LOGIN_HASH: "",
        LINET_LOGIN_COMPANY: ""
    });

    const [repairTerms, setRepairTerms] = useState('');
    const [importerReminderDays, setImporterReminderDays] = useState(7);
    const [importerReminderEnabled, setImporterReminderEnabled] = useState(false);
    const [isRunningReminders, setIsRunningReminders] = useState(false);
    const [importerReminderMessage, setImporterReminderMessage] = useState('');

    const [isEditingVendor, setIsEditingVendor] = useState(false);
    const [currentVendor, setCurrentVendor] = useState(null);
    const [webhookLogs, setWebhookLogs] = useState([]);

    const { currentUser } = useUser();
    const isManager = currentUser?.role === "מנהל";

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setIsLoading(true);
            const [fetchedSettings, fetchedResponses, fetchedVendors, fetchedLogs] = await Promise.all([
                SettingsEntity.list("setting_name"),
                PredefinedResponse.list(),
                RepairVendor.list(),
                WebhookLog.filter({ source: 'botit' }, '-created_date', 50)
            ]);

            setSettings(fetchedSettings);
            setPredefinedResponses(fetchedResponses);
            setVendors(fetchedVendors);
            setWebhookLogs(fetchedLogs);

            const wooSettings = {};
            ['WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET', 'WOOCOMMERCE_SITE_URL'].forEach(key => {
                const setting = fetchedSettings.find(s => s.setting_name === key);
                wooSettings[key] = setting?.setting_value || "";
            });
            setWooCommerceSettings(wooSettings);

            const linetConfig = {};
            ['LINET_LOGIN_ID', 'LINET_LOGIN_HASH', 'LINET_LOGIN_COMPANY'].forEach(key => {
                const setting = fetchedSettings.find(s => s.setting_name === key);
                linetConfig[key] = setting?.setting_value || "";
            });
            setLinetSettings(linetConfig);

            const termsSetting = fetchedSettings.find(s => s.setting_name === 'REPAIR_RECEIPT_TERMS');
            if (termsSetting?.setting_value) {
                setRepairTerms(termsSetting.setting_value);
            }

            // Load importer reminder settings
            const reminderDaysSetting = fetchedSettings.find(s => s.setting_name === 'IMPORTER_REMINDER_DAYS');
            if (reminderDaysSetting?.setting_value) {
                setImporterReminderDays(parseInt(reminderDaysSetting.setting_value) || 7);
            }
            const reminderEnabledSetting = fetchedSettings.find(s => s.setting_name === 'IMPORTER_REMINDER_ENABLED');
            if (reminderEnabledSetting?.setting_value) {
                setImporterReminderEnabled(reminderEnabledSetting.setting_value === 'ON');
            }
            const reminderMessageSetting = fetchedSettings.find(s => s.setting_name === 'IMPORTER_REMINDER_MESSAGE');
            if (reminderMessageSetting?.setting_value) {
                setImporterReminderMessage(reminderMessageSetting.setting_value);
            } else {
                setImporterReminderMessage(`⚠️ *התראה דחופה - תיקון #{{repair_id}}*

המכשיר נמצא אצלכם *{{days}} ימים* ללא עדכון!

👤 לקוח: *{{customer_name}}*
📱 מכשיר: *{{device}}* {{color}}
🔧 תקלה: *{{issue_category}}*
📝 תיאור: {{issue_description}}

❗ נדרש עדכון מיידי על סטטוס התיקון.

GADGET-TEAM`);
            }

            if (!termsSetting?.setting_value) {
                setRepairTerms(`• אני מאשר/ת כי קיבלתי הסבר מפורט על התקלה והתיקון הנדרש
• המכשיר נמסר למעבדה לצורך תיקון בלבד, והמעבדה אינה אחראית לתכנים במכשיר
• מחיר התיקון הסופי עשוי להשתנות בהתאם לממצאי האבחון
• המעבדה תעדכן אותי בכל שינוי במחיר או בזמן הטיפול
• במידה והמכשיר לא ייאסף תוך 30 יום מההודעה על סיום התיקון, המעבדה רשאית לגבות דמי אחסון`);
            }

            // בדיקה אם קיים RESEND_API_KEY
            const resendKeySetting = fetchedSettings.find(s => s.setting_name === 'RESEND_API_KEY');
            if (!resendKeySetting || !resendKeySetting.setting_value) {
                toast.info("חשוב: יש להגדיר RESEND_API_KEY בכרטיסייה 'מיילים' כדי לאפשר שליחת מיילים.", {
                    duration: 5000,
                    icon: "📧"
                });
            }
        } catch (error) {
            console.error("Error loading data:", error);
            toast.error("שגיאה בטעינת נתונים");
        } finally {
            setIsLoading(false);
        }
    };

    const changeTab = (newTab) => {
        setSearchParams({ tab: newTab });
    };

    const handleSettingChange = (id, value) => {
        setSettings(settings.map(s => s.id === id ? { ...s, setting_value: value } : s));
    };

    const handleUpdateSetting = async (id, value) => {
        try {
            await SettingsEntity.update(id, { setting_value: value });
            toast.success("ההגדרה עודכנה בהצלחה", {
                icon: <CheckCircle className="w-4 h-4" />
            });
            loadData(); // Re-load data to ensure state is fully consistent
        } catch (error) {
            console.error("Error updating setting:", error);
            toast.error("שגיאה בעדכון ההגדרה");
        }
    };

    const handleCreateSetting = async () => {
        if (!newSetting.name || !newSetting.value) {
            toast.error("יש למלא שם וערך");
            return;
        }
        try {
            await SettingsEntity.create({
                setting_name: newSetting.name,
                setting_value: newSetting.value,
                notes: newSetting.notes,
            });
            setNewSetting({ name: "", value: "", notes: "" });
            loadData(); // Reload all data to ensure new setting is reflected
            toast.success("ההגדרה נוספה בהצלחה");
        } catch (error) {
            console.error("Error creating setting:", error);
            toast.error("שגיאה ביצירת ההגדרה");
        }
    };

    const handleWooCommerceSave = async () => {
        try {
            for (const [key, value] of Object.entries(wooCommerceSettings)) {
                const existingSetting = settings.find(s => s.setting_name === key);

                if (existingSetting) {
                    await SettingsEntity.update(existingSetting.id, { setting_value: value });
                } else {
                    await SettingsEntity.create({
                        setting_name: key,
                        setting_value: value,
                        notes: `הגדרת ${key.replace(/_/g, ' ')} עבור WooCommerce`
                    });
                }
            }

            toast.success("הגדרות WooCommerce נשמרו בהצלחה!", {
                icon: <CheckCircle className="w-4 h-4" />
            });
            loadData();
        } catch (error) {
            console.error("Error saving WooCommerce settings:", error);
            toast.error("שגיאה בשמירת הגדרות WooCommerce");
        }
    };

    const handleLinetSave = async () => {
        try {
            for (const [key, value] of Object.entries(linetSettings)) {
                const existingSetting = settings.find(s => s.setting_name === key);

                if (existingSetting) {
                    await SettingsEntity.update(existingSetting.id, { setting_value: value });
                } else {
                    await SettingsEntity.create({
                        setting_name: key,
                        setting_value: value,
                        notes: `הגדרת ${key.replace(/_/g, ' ')} עבור Linet API`
                    });
                }
            }

            toast.success("הגדרות Linet נשמרו בהצלחה!", {
                icon: <CheckCircle className="w-4 h-4" />
            });
            loadData();
        } catch (error) {
            console.error("Error saving Linet settings:", error);
            toast.error("שגיאה בשמירת הגדרות Linet");
        }
    };

    const handleCreateResponse = async () => {
        if (!newResponse.response_name || !newResponse.content) {
            toast.error("יש למלא שם תשובה ותוכן");
            return;
        }
        try {
            await PredefinedResponse.create(newResponse);
            setNewResponse({ response_name: "", content: "", channels: ["whatsapp"] });
            loadData();
            toast.success("תבנית התשובה נוספה בהצלחה");
        } catch (error) {
            console.error("Error creating response:", error);
            toast.error("שגיאה ביצירת תבנית");
        }
    };

    const handleDeleteSetting = async (setting) => {
        if (window.confirm(`האם אתה בטוח שברצונך למחוק את ההגדרה "${setting.setting_name}"?`)) {
            try {
                await SettingsEntity.delete(setting.id);
                loadData();
                toast.success("ההגדרה נמחקה בהצלחה");
            } catch (error) {
                console.error("Error deleting setting:", error);
                toast.error("שגיאה במחיקת ההגדרה");
            }
        }
    };

    const handleDeleteResponse = async (response) => {
        if (window.confirm(`האם אתה בטוח שברצונך למחוק את התשובה "${response.response_name}"?`)) {
            try {
                await PredefinedResponse.delete(response.id);
                loadData();
                toast.success("התשובה נמחקה בהצלחה");
            } catch (error) {
                console.error("Error deleting response:", error);
                toast.error("שגיאה במחיקת התשובה");
            }
        }
    };

    const handleSaveTerms = async () => {
        try {
            const existingTermsSetting = settings.find(s => s.setting_name === 'REPAIR_RECEIPT_TERMS');

            if (existingTermsSetting) {
                await SettingsEntity.update(existingTermsSetting.id, { setting_value: repairTerms });
            } else {
                await SettingsEntity.create({
                    setting_name: 'REPAIR_RECEIPT_TERMS',
                    setting_value: repairTerms,
                    notes: 'תנאים והתחייבויות עבור אישור קבלה לתיקון'
                });
            }

            toast.success("תנאי האישור נשמרו בהצלחה!", {
                icon: <CheckCircle className="w-4 h-4" />
            });
            loadData();
        } catch (error) {
            console.error("Error saving terms:", error);
            toast.error("שגיאה בשמירת התנאים");
        }
    };

    const handleAddNewVendor = () => {
        setIsEditingVendor(true);
        setCurrentVendor({ name: '', mobile: '', active: true });
        setVendorError("");
        setVendorSuccess("");
    };

    const handleEditVendor = (vendor) => {
        setIsEditingVendor(true);
        setCurrentVendor(vendor);
        setVendorError("");
        setVendorSuccess("");
    };

    const handleCancelVendor = () => {
        setIsEditingVendor(false);
        setCurrentVendor(null);
        setVendorError("");
        setVendorSuccess("");
    };

    const handleVendorChange = (e) => {
        const { name, value } = e.target;
        setCurrentVendor({ ...currentVendor, [name]: value });
        setVendorError("");
    };

    const handleSaveVendor = async () => {
        setVendorError("");
        setVendorSuccess("");

        if (!currentVendor || !currentVendor.name || !currentVendor.mobile) {
            toast.error("שם וטלפון הם שדות חובה");
            return;
        }

        try {
            if (currentVendor.id) {
                await RepairVendor.update(currentVendor.id, {
                    name: currentVendor.name,
                    mobile: currentVendor.mobile,
                    active: currentVendor.active !== false,
                });
                toast.success("היבואן עודכן בהצלחה!", {
                    icon: <CheckCircle className="w-4 h-4" />
                });
            } else {
                await RepairVendor.create({
                    name: currentVendor.name,
                    mobile: currentVendor.mobile,
                    active: currentVendor.active !== false
                });
                toast.success("היבואן נוצר בהצלחה!", {
                    icon: <CheckCircle className="w-4 h-4" />
                });
            }

            await loadData();
            handleCancelVendor();

        } catch (error) {
            console.error("Error saving vendor:", error);
            toast.error(`שגיאה בשמירת היבואן: ${error.message}`);
        }
    };

    const handleDeleteVendor = async (vendor) => {
        if (window.confirm(`האם אתה בטוח שברצונך למחוק את היבואן "${vendor.name}"?`)) {
            try {
                await RepairVendor.delete(vendor.id);
                loadData();
                toast.success("היבואן נמחק בהצלחה");
            } catch (error) {
                console.error("Error deleting vendor:", error);
                toast.error("שגיאה במחיקת היבואן");
            }
        }
    };

    const toggleVendorActiveStatus = async (vendor) => {
        try {
            await RepairVendor.update(vendor.id, { active: !vendor.active });
            loadData();
            toast.success(vendor.active ? "היבואן הופך ללא פעיל" : "היבואן הופעל מחדש");
        } catch (error) {
            console.error("Error toggling vendor status:", error);
            toast.error("שגיאה בשינוי סטטוס");
        }
    };

    if (!isManager) {
        return (
            <div className="p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
                <Card className="glass-card border-0">
                    <CardContent className="p-8 text-center">
                        <SettingsIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <h2 className="text-xl font-bold text-gray-900 mb-2">גישה מוגבלת</h2>
                        <p className="text-gray-600">דף הגדרות זמין למנהלים בלבד</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="p-6 space-y-6" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
                <h1 className="text-3xl font-bold" style={{ color: '#1C1C1E' }}>הגדרות מערכת</h1>
                <div className="glass-card p-6 animate-pulse h-64"></div>
            </div>
        );
    }

    const resendApiKey = settings.find(s => s.setting_name === 'RESEND_API_KEY');
    const autoReplyEmail = settings.find(s => s.setting_name === 'AUTO_REPLY_EMAIL');
    const emailTemplate = settings.find(s => s.setting_name === 'EMAIL_AUTOREPLY_TEMPLATE');

    return (
        <div className="p-6 space-y-8" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold" style={{ color: '#1C1C1E' }}>הגדרות מערכת</h1>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <SettingsIcon className="w-4 h-4" />
                    <span>ניהול הגדרות המערכת</span>
                </div>
            </div>

            <WhatsAppStatusAlert />

            <Tabs value={currentTab} onValueChange={changeTab} className="w-full">
                <TabsList className="glass-card p-2 rounded-2xl grid grid-cols-2 md:grid-cols-7 gap-1">
                    <TabsTrigger value="whatsapp" className="rounded-xl data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                        <MessageCircle className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">וואטסאפ</span>
                    </TabsTrigger>
                    <TabsTrigger value="emails" className="rounded-xl data-[state=active]:bg-cyan-500 data-[state=active]:text-white">
                        <MessageCircle className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">מיילים</span>
                    </TabsTrigger>
                    <TabsTrigger value="vendors" className="rounded-xl data-[state=active]:bg-orange-500 data-[state=active]:text-white">
                        <Truck className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">יבואנים</span>
                    </TabsTrigger>
                    <TabsTrigger value="importer-reminders" className="rounded-xl data-[state=active]:bg-red-500 data-[state=active]:text-white">
                        <Bell className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">תזכורות יבואן</span>
                    </TabsTrigger>
                    <TabsTrigger value="woocommerce" className="rounded-xl data-[state=active]:bg-purple-500 data-[state=active]:text-white">
                        <ShoppingCart className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">WooCommerce</span>
                    </TabsTrigger>
                    <TabsTrigger value="terms" className="rounded-xl data-[state=active]:bg-indigo-500 data-[state=active]:text-white">
                        <SettingsIcon className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">תנאי קבלה</span>
                    </TabsTrigger>
                    <TabsTrigger value="responses" className="rounded-xl data-[state=active]:bg-green-500 data-[state=active]:text-white">
                        <MessageCircle className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">תבניות תשובה</span>
                    </TabsTrigger>
                    <TabsTrigger value="linet" className="rounded-xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                        <FileText className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">Linet</span>
                    </TabsTrigger>
                    <TabsTrigger value="advanced" className="rounded-xl data-[state=active]:bg-gray-500 data-[state=active]:text-white">
                        <SettingsIcon className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">מתקדם</span>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="whatsapp" className="space-y-6 mt-6">
                    <Card className="glass-card border-2 border-blue-200">
                        <CardHeader>
                            <CardTitle style={{ color: '#7D0F82' }} className="flex items-center gap-2">
                                <MessageCircle className="w-5 h-5" />
                                ספקי וואטסאפ
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                הגדר את הספק שדרכו תשלח המערכת הודעות וואטסאפ אוטומטיות
                            </p>
                        </CardHeader>
                        <CardContent>
                            <a href="/whatsapp-providers" target="_blank">
                                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white text-lg py-6">
                                    <MessageCircle className="w-5 h-5 mr-2" />
                                    פתח ניהול ספקי וואטסאפ
                                </Button>
                            </a>
                        </CardContent>
                    </Card>

                    {/* Webhook Logs Table */}
                    <Card className="glass-card border-2 border-green-200">
                        <CardHeader>
                            <CardTitle style={{ color: '#16A34A' }} className="flex items-center gap-2">
                                <MessageCircle className="w-5 h-5" />
                                לוג הודעות נכנסות ({webhookLogs.length})
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                50 ההודעות האחרונות שהתקבלו דרך הוובהוק
                            </p>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>שם</TableHead>
                                            <TableHead>הודעה</TableHead>
                                            <TableHead>טלפון</TableHead>
                                            <TableHead>תאריך ושעה</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {webhookLogs.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan="4" className="text-center py-8 text-gray-500">
                                                    <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                                    <p>אין הודעות נכנסות בלוג</p>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            webhookLogs.map(log => (
                                                <TableRow key={log.id}>
                                                    <TableCell className="font-medium">
                                                        {log.payload?.name || '-'}
                                                    </TableCell>
                                                    <TableCell className="max-w-xs truncate">
                                                        {log.payload?.message || '-'}
                                                    </TableCell>
                                                    <TableCell dir="ltr" className="text-left">
                                                        {log.payload?.phone || '-'}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-gray-600">
                                                        {new Date(log.created_date).toLocaleString('he-IL', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: '2-digit',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="emails" className="space-y-6 mt-6">
                    {/* Resend API Key */}
                    <Card className="glass-card border-2 border-cyan-200">
                        <CardHeader>
                            <CardTitle style={{ color: '#007A8A' }} className="flex items-center gap-2">
                                <MessageCircle className="w-5 h-5" />
                                הגדרת Resend API Key
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-cyan-50 p-4 rounded-lg space-y-2">
                                <p className="text-sm font-semibold text-cyan-900">📧 מיילים נשלחים מ-service@gadget-team.co.il</p>
                                <p className="text-xs text-cyan-700">
                                    ✅ הדומיין gadget-team.co.il מאומת ב-Resend
                                </p>
                            </div>

                            {resendApiKey ? (
                                <div className="space-y-3">
                                    <Label className="font-semibold">Resend API Key</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            type="password"
                                            value={resendApiKey.setting_value}
                                            onChange={(e) => handleSettingChange(resendApiKey.id, e.target.value)}
                                            className="glass-button font-mono text-sm"
                                            placeholder="re_xxxxxxxxxxxxx"
                                        />
                                        <Button
                                            onClick={() => handleUpdateSetting(resendApiKey.id, resendApiKey.setting_value)}
                                            className="bg-cyan-600 hover:bg-cyan-700 text-white"
                                            disabled={!resendApiKey.setting_value}
                                        >
                                            <Save className="w-4 h-4 ml-2" />
                                            שמור
                                        </Button>
                                    </div>
                                    {resendApiKey.setting_value && (
                                        <p className="text-xs text-green-600 flex items-center gap-1 mt-1">
                                            <CheckCircle className="w-3 h-3" />
                                            API Key מוגדר
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <Label className="font-semibold">Resend API Key *</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            value={newSetting.name === 'RESEND_API_KEY' ? newSetting.value : ''}
                                            onChange={(e) => setNewSetting({ name: 'RESEND_API_KEY', value: e.target.value, notes: 'Resend API Key for email sending' })}
                                            placeholder="re_xxxxxxxxxxxxx"
                                            className="glass-button font-mono text-sm"
                                        />
                                        <Button
                                            onClick={handleCreateSetting}
                                            className="bg-green-600 hover:bg-green-700 text-white"
                                            disabled={!newSetting.value || newSetting.name !== 'RESEND_API_KEY'}
                                        >
                                            <Plus className="w-4 h-4 ml-2" />
                                            הוסף
                                        </Button>
                                    </div>
                                    <p className="text-xs text-orange-600 mt-1">⚠️ חובה להגדיר API Key כדי לשלוח מיילים</p>
                                </div>
                            )}

                            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                                <p className="text-sm font-semibold">איך להשיג API Key?</p>
                                <ol className="text-xs text-gray-700 space-y-1 list-decimal list-inside">
                                    <li>היכנס ל-<a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Resend Dashboard</a></li>
                                    <li>לחץ על "Create API Key"</li>
                                    <li>תן שם למפתח (למשל: "Gadget Team CRM")</li>
                                    <li>בחר הרשאה: <strong>"Full Access"</strong></li>
                                    <li>העתק את המפתח והדבק אותו כאן</li>
                                </ol>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Auto Reply Settings */}
                    <Card className="glass-card">
                        <CardHeader>
                            <CardTitle style={{ color: '#7D0F82' }} className="flex items-center gap-2">
                                <MessageCircle className="w-5 h-5" />
                                מענה אוטומטי למיילים
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Toggle Auto Reply */}
                            {autoReplyEmail ? (
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                    <div>
                                        <Label className="font-semibold">מענה אוטומטי פעיל</Label>
                                        <p className="text-xs text-gray-600">שלח מענה אוטומטי כשמתקבל מייל חדש</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-medium">
                                            {autoReplyEmail.setting_value === 'ON' ? 'פעיל' : 'כבוי'}
                                        </span>
                                        <Switch
                                            checked={autoReplyEmail.setting_value === 'ON'}
                                            onCheckedChange={(checked) => {
                                                const newValue = checked ? 'ON' : 'OFF';
                                                handleSettingChange(autoReplyEmail.id, newValue);
                                                handleUpdateSetting(autoReplyEmail.id, newValue);
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    onClick={async () => {
                                        await SettingsEntity.create({
                                            setting_name: 'AUTO_REPLY_EMAIL',
                                            setting_value: 'OFF',
                                            notes: 'Auto reply for emails'
                                        });
                                        loadData();
                                        toast.success("הגדרת מענה אוטומטי נוצרה");
                                    }}
                                    variant="outline"
                                    className="w-full text-blue-600 border-blue-600 hover:bg-blue-50"
                                >
                                    <Plus className="w-4 h-4 ml-2" />
                                    הפעל מענה אוטומטי
                                </Button>
                            )}

                            {/* Email Template */}
                            {emailTemplate ? (
                                <div className="space-y-3">
                                    <Label className="font-semibold">תבנית מענה אוטומטי</Label>
                                    <Textarea
                                        value={emailTemplate.setting_value}
                                        onChange={(e) => handleSettingChange(emailTemplate.id, e.target.value)}
                                        rows={6}
                                        className="glass-button font-sans"
                                        placeholder="שלום,&#10;&#10;תודה על פנייתך...&#10;&#10;בברכה,&#10;צוות Gadget Team"
                                    />
                                    <div className="flex justify-end items-center mt-2">
                                        <p className="text-xs text-gray-500 mr-auto">
                                            💡 תוכל להשתמש ב-{`{{whatsapp_number}}`} להוספת מספר וואטסאפ
                                        </p>
                                        <Button
                                            onClick={() => handleUpdateSetting(emailTemplate.id, emailTemplate.setting_value)}
                                            className="bg-purple-600 hover:bg-purple-700 text-white"
                                        >
                                            <Save className="w-4 h-4 ml-2" />
                                            שמור תבנית
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    onClick={async () => {
                                        await SettingsEntity.create({
                                            setting_name: 'EMAIL_AUTOREPLY_TEMPLATE',
                                            setting_value: 'שלום,\n\nתודה על פנייתך אלינו.\nקיבלנו את הודעתך ונחזור אליך בהקדם האפשרי.\n\nניתן לפנות אלינו גם בוואטסאפ: {{whatsapp_number}}\n\nבברכה,\nצוות Gadget Team',
                                            notes: 'Email auto-reply template'
                                        });
                                        loadData();
                                        toast.success("תבנית ברירת מחדל נוצרה");
                                    }}
                                    variant="outline"
                                    className="w-full text-purple-600 border-purple-600 hover:bg-purple-50"
                                >
                                    <Plus className="w-4 h-4 ml-2" />
                                    צור תבנית מענה
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="vendors" className="space-y-6 mt-6">
                    {isEditingVendor ? (
                        <Card className="glass-card">
                            <CardHeader>
                                <CardTitle style={{ color: '#7D0F82' }}>
                                    {currentVendor?.id ? 'עריכת יבואן' : 'יבואן חדש'}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label>שם היבואן *</Label>
                                    <Input
                                        name="name"
                                        placeholder="שם היבואן"
                                        value={currentVendor?.name || ''}
                                        onChange={handleVendorChange}
                                        className="glass-button"
                                    />
                                </div>
                                <div>
                                    <Label>טלפון ליצירת קשר *</Label>
                                    <Input
                                        name="mobile"
                                        placeholder="0501234567"
                                        value={currentVendor?.mobile || ''}
                                        onChange={handleVendorChange}
                                        className="glass-button"
                                    />
                                </div>
                                <div className="flex items-center space-x-2 space-x-reverse">
                                    <Switch
                                        id="active-switch"
                                        checked={currentVendor?.active !== false}
                                        onCheckedChange={(checked) => setCurrentVendor({ ...currentVendor, active: checked })}
                                    />
                                    <Label htmlFor="active-switch" className="text-sm font-medium">פעיל</Label>
                                </div>

                                <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800">
                                    <strong>💡 לידיעה:</strong> יבואנים משמשים לניהול תיקונים שנשלחים למעבדות חיצוניות.
                                </div>

                                <div className="flex justify-end gap-3 pt-4">
                                    <Button variant="ghost" onClick={handleCancelVendor}>
                                        ביטול
                                    </Button>
                                    <Button
                                        onClick={handleSaveVendor}
                                        style={{backgroundColor: '#7D0F82', color: 'white'}}
                                        disabled={!currentVendor?.name || !currentVendor?.mobile}
                                    >
                                        <Save className="w-4 h-4 ml-2"/>
                                        שמור
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            <div className="flex justify-between items-center">
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">יבואנים ומעבדות</h2>
                                    <p className="text-sm text-gray-600 mt-1">ניהול יבואנים ומעבדות חיצוניות לתיקונים</p>
                                </div>
                                <Button
                                    onClick={handleAddNewVendor}
                                    className="glass-button"
                                    style={{backgroundColor: '#7D0F82', color: 'white'}}
                                >
                                    <Plus className="w-4 h-4 ml-2" />
                                    הוסף יבואן חדש
                                </Button>
                            </div>

                            <Card className="glass-card border-0">
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>שם</TableHead>
                                                    <TableHead>טלפון</TableHead>
                                                    <TableHead>סטטוס</TableHead>
                                                    <TableHead>פעולות</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {vendors.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan="4" className="text-center py-8 text-gray-500">
                                                            <Truck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                                            <p>אין יבואנים במערכת</p>
                                                            <p className="text-sm mt-1">לחץ על "הוסף יבואן חדש" כדי להתחיל</p>
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    vendors.map(vendor => (
                                                        <TableRow key={vendor.id}>
                                                            <TableCell className="font-medium">{vendor.name}</TableCell>
                                                            <TableCell>{vendor.mobile}</TableCell>
                                                            <TableCell>
                                                                <span className={`px-2 py-1 rounded-full text-xs ${vendor.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                                    {vendor.active ? 'פעיל' : 'לא פעיל'}
                                                                </span>
                                                            </TableCell>
                                                            <TableCell className="flex gap-2">
                                                                <Button size="icon" variant="ghost" onClick={() => handleEditVendor(vendor)}>
                                                                    <Edit className="w-4 h-4 text-blue-600"/>
                                                                </Button>
                                                                <Button size="icon" variant="ghost" onClick={() => toggleVendorActiveStatus(vendor)}>
                                                                    {vendor.active ? <ToggleRight className="w-5 h-5 text-green-500"/> : <ToggleLeft className="w-5 h-5 text-gray-500"/>}
                                                                </Button>
                                                                <Button size="icon" variant="ghost" onClick={() => handleDeleteVendor(vendor)}>
                                                                    <Trash2 className="w-4 h-4 text-red-600"/>
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </TabsContent>

                <TabsContent value="importer-reminders" className="space-y-6 mt-6">
                    <Card className="glass-card border-2 border-red-200">
                        <CardHeader>
                            <CardTitle style={{ color: '#DC2626' }} className="flex items-center gap-2">
                                <Bell className="w-5 h-5" />
                                תזכורות אוטומטיות ליבואנים
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                הגדר שליחת תזכורות וואטסאפ אוטומטיות ליבואנים כאשר תיקון נמצא אצלם יותר מדי זמן
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Enable/Disable Toggle */}
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                <div>
                                    <Label className="font-semibold text-lg">תזכורות פעילות</Label>
                                    <p className="text-sm text-gray-600">שלח תזכורות אוטומטיות ליבואנים</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-sm font-medium ${importerReminderEnabled ? 'text-green-600' : 'text-gray-500'}`}>
                                        {importerReminderEnabled ? '✅ פעיל' : '⏸️ כבוי'}
                                    </span>
                                    <Switch
                                        checked={importerReminderEnabled}
                                        onCheckedChange={async (checked) => {
                                            setImporterReminderEnabled(checked);
                                            const existingSetting = settings.find(s => s.setting_name === 'IMPORTER_REMINDER_ENABLED');
                                            if (existingSetting) {
                                                await SettingsEntity.update(existingSetting.id, { setting_value: checked ? 'ON' : 'OFF' });
                                            } else {
                                                await SettingsEntity.create({
                                                    setting_name: 'IMPORTER_REMINDER_ENABLED',
                                                    setting_value: checked ? 'ON' : 'OFF',
                                                    notes: 'האם תזכורות יבואן פעילות'
                                                });
                                            }
                                            toast.success(checked ? 'תזכורות הופעלו' : 'תזכורות כובו');
                                            loadData();
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Days Setting */}
                            <div className="p-4 bg-blue-50 rounded-lg space-y-4">
                                <div>
                                    <Label className="font-semibold">מספר ימים לפני שליחת תזכורת</Label>
                                    <p className="text-sm text-gray-600 mb-3">
                                        כמה ימים צריכים לעבור מאז שהמכשיר הגיע ליבואן לפני שנשלח תזכורת
                                    </p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <Input
                                        type="number"
                                        min="1"
                                        max="30"
                                        value={importerReminderDays}
                                        onChange={(e) => setImporterReminderDays(parseInt(e.target.value) || 7)}
                                        className="w-24 glass-button text-center text-lg font-bold"
                                    />
                                    <span className="text-gray-700 font-medium">ימים</span>
                                    <Button
                                        onClick={async () => {
                                            const existingSetting = settings.find(s => s.setting_name === 'IMPORTER_REMINDER_DAYS');
                                            if (existingSetting) {
                                                await SettingsEntity.update(existingSetting.id, { setting_value: importerReminderDays.toString() });
                                            } else {
                                                await SettingsEntity.create({
                                                    setting_name: 'IMPORTER_REMINDER_DAYS',
                                                    setting_value: importerReminderDays.toString(),
                                                    notes: 'מספר ימים לתזכורת יבואן'
                                                });
                                            }
                                            toast.success(`הגדרה נשמרה: תזכורת תישלח אחרי ${importerReminderDays} ימים`);
                                            loadData();
                                        }}
                                        className="bg-blue-600 hover:bg-blue-700 text-white"
                                    >
                                        <Save className="w-4 h-4 ml-2" />
                                        שמור
                                    </Button>
                                </div>
                            </div>

                            {/* Manual Run */}
                            <div className="p-4 bg-orange-50 rounded-lg space-y-3">
                                <div>
                                    <Label className="font-semibold">הפעלה ידנית</Label>
                                    <p className="text-sm text-gray-600">
                                        לחץ כדי לשלוח תזכורות עכשיו לכל התיקונים שעברו את מספר הימים המוגדר
                                    </p>
                                </div>
                                <Button
                                    onClick={async () => {
                                        setIsRunningReminders(true);
                                        try {
                                            const result = await importerReminders({});
                                            if (result.data?.success) {
                                                toast.success(`נשלחו ${result.data.remindersSent || 0} תזכורות מתוך ${result.data.checked || 0} תיקונים`);
                                            } else {
                                                toast.error('שגיאה בשליחת תזכורות: ' + (result.data?.error || 'Unknown error'));
                                            }
                                        } catch (error) {
                                            console.error('Error running reminders:', error);
                                            toast.error('שגיאה בשליחת תזכורות');
                                        } finally {
                                            setIsRunningReminders(false);
                                        }
                                    }}
                                    disabled={isRunningReminders}
                                    className="bg-orange-600 hover:bg-orange-700 text-white"
                                >
                                    {isRunningReminders ? (
                                        <>
                                            <span className="animate-spin mr-2">⏳</span>
                                            שולח תזכורות...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="w-4 h-4 ml-2" />
                                            שלח תזכורות עכשיו
                                        </>
                                    )}
                                </Button>
                            </div>

                            {/* Message Template */}
                            <div className="p-4 bg-purple-50 rounded-lg space-y-3">
                                <div>
                                    <Label className="font-semibold">תוכן ההודעה</Label>
                                    <p className="text-sm text-gray-600 mb-2">
                                        ערוך את תוכן ההודעה שנשלחת ליבואן. השתמש במשתנים הבאים:
                                    </p>
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        <code className="text-xs bg-white px-2 py-1 rounded border">{`{{repair_id}}`}</code>
                                        <code className="text-xs bg-white px-2 py-1 rounded border">{`{{days}}`}</code>
                                        <code className="text-xs bg-white px-2 py-1 rounded border">{`{{customer_name}}`}</code>
                                        <code className="text-xs bg-white px-2 py-1 rounded border">{`{{device}}`}</code>
                                        <code className="text-xs bg-white px-2 py-1 rounded border">{`{{color}}`}</code>
                                        <code className="text-xs bg-white px-2 py-1 rounded border">{`{{issue_category}}`}</code>
                                        <code className="text-xs bg-white px-2 py-1 rounded border">{`{{issue_description}}`}</code>
                                    </div>
                                </div>
                                <Textarea
                                    value={importerReminderMessage}
                                    onChange={(e) => setImporterReminderMessage(e.target.value)}
                                    rows={12}
                                    className="glass-button font-sans text-sm"
                                    style={{ direction: 'rtl' }}
                                />
                                <Button
                                    onClick={async () => {
                                        const existingSetting = settings.find(s => s.setting_name === 'IMPORTER_REMINDER_MESSAGE');
                                        if (existingSetting) {
                                            await SettingsEntity.update(existingSetting.id, { setting_value: importerReminderMessage });
                                        } else {
                                            await SettingsEntity.create({
                                                setting_name: 'IMPORTER_REMINDER_MESSAGE',
                                                setting_value: importerReminderMessage,
                                                notes: 'תבנית הודעת תזכורת ליבואן'
                                            });
                                        }
                                        toast.success('תבנית ההודעה נשמרה');
                                        loadData();
                                    }}
                                    className="bg-purple-600 hover:bg-purple-700 text-white"
                                >
                                    <Save className="w-4 h-4 ml-2" />
                                    שמור תבנית הודעה
                                </Button>
                            </div>

                            {/* Vendors List with Additional Phones */}
                            <div className="p-4 bg-green-50 rounded-lg space-y-4">
                                <div>
                                    <Label className="font-semibold text-lg">יבואנים ומספרי טלפון</Label>
                                    <p className="text-sm text-gray-600">
                                        הוסף מספרי טלפון נוספים לכל יבואן לקבלת תזכורות
                                    </p>
                                </div>
                                
                                {vendors.length === 0 ? (
                                    <p className="text-gray-500 text-center py-4">אין יבואנים במערכת</p>
                                ) : (
                                    <div className="space-y-3">
                                        {vendors.map(vendor => (
                                            <div key={vendor.id} className="bg-white rounded-lg p-4 border">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <span className={`w-3 h-3 rounded-full ${vendor.active ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                                        <span className="font-semibold">{vendor.name}</span>
                                                    </div>
                                                    <span className="text-sm text-gray-600">ראשי: {vendor.mobile}</span>
                                                </div>
                                                
                                                <div className="space-y-2">
                                                    <Label className="text-sm text-gray-600">מספרים נוספים לתזכורות:</Label>
                                                    <div className="flex flex-wrap gap-2 mb-2">
                                                        {(vendor.additional_phones || []).map((phone, idx) => (
                                                            <div key={idx} className="flex items-center gap-1 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                                                                {phone}
                                                                <button
                                                                    onClick={async () => {
                                                                        const newPhones = (vendor.additional_phones || []).filter((_, i) => i !== idx);
                                                                        await RepairVendor.update(vendor.id, { additional_phones: newPhones });
                                                                        toast.success('מספר הוסר');
                                                                        loadData();
                                                                    }}
                                                                    className="text-blue-600 hover:text-red-600 mr-1"
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            id={`new-phone-${vendor.id}`}
                                                            placeholder="הוסף מספר נוסף..."
                                                            className="flex-1 h-9 text-sm"
                                                            onKeyDown={async (e) => {
                                                                if (e.key === 'Enter' && e.target.value.trim()) {
                                                                    const newPhone = e.target.value.trim();
                                                                    const currentPhones = vendor.additional_phones || [];
                                                                    await RepairVendor.update(vendor.id, { 
                                                                        additional_phones: [...currentPhones, newPhone] 
                                                                    });
                                                                    e.target.value = '';
                                                                    toast.success('מספר נוסף');
                                                                    loadData();
                                                                }
                                                            }}
                                                        />
                                                        <Button
                                                            size="sm"
                                                            onClick={async () => {
                                                                const input = document.getElementById(`new-phone-${vendor.id}`);
                                                                if (input?.value.trim()) {
                                                                    const newPhone = input.value.trim();
                                                                    const currentPhones = vendor.additional_phones || [];
                                                                    await RepairVendor.update(vendor.id, { 
                                                                        additional_phones: [...currentPhones, newPhone] 
                                                                    });
                                                                    input.value = '';
                                                                    toast.success('מספר נוסף');
                                                                    loadData();
                                                                }
                                                            }}
                                                            className="bg-green-600 hover:bg-green-700 text-white h-9"
                                                        >
                                                            <Plus className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Info Box */}
                            <div className="bg-gray-100 p-4 rounded-lg">
                                <h4 className="font-semibold text-gray-800 mb-2">💡 איך זה עובד?</h4>
                                <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                                    <li>המערכת בודקת תיקונים בסטטוס "אצל היבואן"</li>
                                    <li>אם עברו יותר מ-{importerReminderDays} ימים, נשלחת הודעת וואטסאפ ליבואן</li>
                                    <li>ההודעה נשלחת למספר הראשי + כל המספרים הנוספים שהוגדרו</li>
                                    <li>התזכורת מתועדת בהיסטוריית התיקון</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="woocommerce" className="space-y-6 mt-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle style={{ color: '#7D0F82' }} className="flex items-center gap-2">
                                <ShoppingCart className="w-5 h-5" />
                                הגדרות WooCommerce
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                הזן את פרטי ההתחברות לאתר WooCommerce שלך כדי לאפשר סנכרון הזמנות אוטומטי
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-4">
                                <div>
                                    <Label htmlFor="woo-url" className="text-sm font-medium">כתובת אתר WooCommerce</Label>
                                    <Input
                                        id="woo-url"
                                        type="url"
                                        placeholder="https://example.com"
                                        value={wooCommerceSettings.WOOCOMMERCE_SITE_URL}
                                        onChange={(e) => setWooCommerceSettings({
                                            ...wooCommerceSettings,
                                            WOOCOMMERCE_SITE_URL: e.target.value
                                        })}
                                        className="glass-button mt-1"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        הכתובת המלאה של האתר שלך (ללא / בסוף)
                                    </p>
                                </div>

                                <div>
                                    <Label htmlFor="consumer-key" className="text-sm font-medium">Consumer Key</Label>
                                    <Input
                                        id="consumer-key"
                                        type="text"
                                        placeholder="ck_xxxxxxxxxxxxxxxx"
                                        value={wooCommerceSettings.WOOCOMMERCE_CONSUMER_KEY}
                                        onChange={(e) => setWooCommerceSettings({
                                            ...wooCommerceSettings,
                                            WOOCOMMERCE_CONSUMER_KEY: e.target.value
                                        })}
                                        className="glass-button mt-1 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        מפתח הצרכן מ-WooCommerce REST API
                                    </p>
                                </div>

                                <div>
                                    <Label htmlFor="consumer-secret" className="text-sm font-medium">Consumer Secret</Label>
                                    <Input
                                        id="consumer-secret"
                                        type="password"
                                        placeholder="cs_xxxxxxxxxxxxxxxx"
                                        value={wooCommerceSettings.WOOCOMMERCE_CONSUMER_SECRET}
                                        onChange={(e) => setWooCommerceSettings({
                                            ...wooCommerceSettings,
                                            WOOCOMMERCE_CONSUMER_SECRET: e.target.value
                                        })}
                                        className="glass-button mt-1 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        סוד הצרכן מ-WooCommerce REST API
                                    </p>
                                </div>
                            </div>

                            <div className="bg-blue-50 p-4 rounded-lg">
                                <h4 className="font-semibold text-blue-800 mb-2">איך ליצור מפתחות API ב-WooCommerce:</h4>
                                <ol className="text-sm text-blue-700 space-y-1 mr-4">
                                    <li>1. היכנס לוורדפרס שלך כמנהל</li>
                                    <li>2. לך לתפריט WooCommerce → הגדרות</li>
                                    <li>3. לחץ על לשונית "מתקדם" ואז "REST API"</li>
                                    <li>4. לחץ על "הוסף מפתח" ובחר הרשאות "קריאה/כתיבה"</li>
                                    <li>5. העתק את Consumer Key ו-Consumer Secret לכאן</li>
                                </ol>
                            </div>

                            <Button
                                onClick={handleWooCommerceSave}
                                className="glass-button w-full"
                                style={{ background: '#7D0F82', color: 'white' }}
                                size="lg"
                            >
                                <Save className="w-4 h-4 ml-2" />
                                שמור הגדרות WooCommerce
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="terms" className="space-y-6 mt-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle style={{ color: '#7D0F82' }}>תנאים והתחייבויות לאישור קבלה</CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                ערוך את התנאים שיופיעו בטופס אישור הקבלה שמודפס ללקוח.
                                כל שורה שמתחילה ב-• תופיע כנקודה נפרדת.
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="terms-text" className="text-sm font-medium mb-2 block">
                                    טקסט התנאים וההתחייבויות:
                                </Label>
                                <Textarea
                                    id="terms-text"
                                    value={repairTerms}
                                    onChange={(e) => setRepairTerms(e.target.value)}
                                    className="glass-button font-sans"
                                    rows={15}
                                    placeholder="הזן את התנאים כאן...
כל שורה שמתחילה ב-• תופיע כנקודה נפרדת"
                                    style={{ direction: 'rtl', textAlign: 'right' }}
                                />
                                <p className="text-xs text-gray-500 mt-2">
                                    💡 טיפ: השתמש ב-• בתחילת כל שורה כדי ליצור נקודות
                                </p>
                            </div>

                            <div className="bg-blue-50 p-4 rounded-lg">
                                <h4 className="font-semibold text-blue-800 mb-2">תצוגה מקדימה:</h4>
                                <div className="bg-white p-4 rounded border border-blue-200">
                                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                                        {repairTerms || 'הטקסט יופיע כאן...'}
                                    </div>
                                </div>
                            </div>

                            <Button
                                onClick={handleSaveTerms}
                                className="glass-button w-full"
                                style={{ background: '#7D0F82', color: 'white' }}
                                size="lg"
                            >
                                <Save className="w-4 h-4 ml-2" />
                                שמור תנאים
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="responses" className="space-y-6 mt-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900">תבניות תשובה מהירות</h2>
                            <p className="text-sm text-gray-600 mt-1">תשובות מוכנות לשימוש מהיר בטיקטים</p>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        {predefinedResponses.map((response) => (
                            <Card key={response.id} className="glass-card border-0">
                                <CardHeader>
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-lg" style={{ color: '#7D0F82' }}>{response.response_name}</CardTitle>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="text-red-600 hover:bg-red-50"
                                            onClick={() => handleDeleteResponse(response)}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-gray-700 mb-2">{response.content}</p>
                                    <div className="flex gap-2">
                                        {response.channels?.map(channel => (
                                            <span key={channel} className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                                                {channel}
                                            </span>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle style={{ color: '#7D0F82' }}>הוספת תבנית תשובה חדשה</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>שם התבנית</Label>
                                    <Input
                                        value={newResponse.response_name}
                                        onChange={(e) => setNewResponse({ ...newResponse, response_name: e.target.value })}
                                        placeholder="תשובה מהירה 1"
                                        className="glass-button"
                                    />
                                </div>
                                <div>
                                    <Label>ערוצים</Label>
                                    <div className="flex gap-2 pt-2">
                                        <label className="flex items-center">
                                            <input type="checkbox" checked={newResponse.channels.includes("whatsapp")}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setNewResponse({...newResponse, channels: [...newResponse.channels, "whatsapp"]});
                                                    } else {
                                                        setNewResponse({...newResponse, channels: newResponse.channels.filter(c => c !== "whatsapp")});
                                                    }
                                                }}
                                            />
                                            <span className="mr-2">וואטסאפ</span>
                                        </label>
                                        <label className="flex items-center">
                                            <input type="checkbox" checked={newResponse.channels.includes("email")}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setNewResponse({...newResponse, channels: [...newResponse.channels, "email"]});
                                                    } else {
                                                        setNewResponse({...newResponse, channels: newResponse.channels.filter(c => c !== "email")});
                                                    }
                                                }}
                                            />
                                            <span className="mr-2">מייל</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <Label>תוכן התשובה</Label>
                                <Textarea
                                    value={newResponse.content}
                                    onChange={(e) => setNewResponse({ ...newResponse, content: e.target.value })}
                                    placeholder="שלום, תודה על פנייתך..."
                                    className="glass-button"
                                    rows={4}
                                />
                            </div>
                            <Button onClick={handleCreateResponse} className="glass-button" style={{ background: '#7D0F82', color: 'white' }}>
                                <Plus className="w-4 h-4 ml-2" />
                                הוסף תבנית תשובה
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="linet" className="space-y-6 mt-6">
                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle style={{ color: '#4F46E5' }} className="flex items-center gap-2">
                                <FileText className="w-5 h-5" />
                                הגדרות Linet
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-2">
                                הזן את פרטי ההתחברות ל-API של לינט כדי לאפשר סנכרון מסמכים
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-4">
                                <div>
                                    <Label htmlFor="linet-login-id" className="text-sm font-medium">Login ID</Label>
                                    <Input
                                        id="linet-login-id"
                                        type="text"
                                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        value={linetSettings.LINET_LOGIN_ID}
                                        onChange={(e) => setLinetSettings({
                                            ...linetSettings,
                                            LINET_LOGIN_ID: e.target.value
                                        })}
                                        className="glass-button mt-1 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        מזהה המשתמש מלינט
                                    </p>
                                </div>

                                <div>
                                    <Label htmlFor="linet-login-hash" className="text-sm font-medium">Login Hash</Label>
                                    <Input
                                        id="linet-login-hash"
                                        type="password"
                                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        value={linetSettings.LINET_LOGIN_HASH}
                                        onChange={(e) => setLinetSettings({
                                            ...linetSettings,
                                            LINET_LOGIN_HASH: e.target.value
                                        })}
                                        className="glass-button mt-1 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        מפתח ההצפנה (Hash) מלינט
                                    </p>
                                </div>

                                <div>
                                    <Label htmlFor="linet-login-company" className="text-sm font-medium">מזהה חברה (Company ID)</Label>
                                    <Input
                                        id="linet-login-company"
                                        type="number"
                                        placeholder="1"
                                        value={linetSettings.LINET_LOGIN_COMPANY}
                                        onChange={(e) => setLinetSettings({
                                            ...linetSettings,
                                            LINET_LOGIN_COMPANY: e.target.value
                                        })}
                                        className="glass-button mt-1 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        מספר החברה בלינט (בדרך כלל 1)
                                    </p>
                                </div>
                            </div>

                            <div className="bg-indigo-50 p-4 rounded-lg">
                                <h4 className="font-semibold text-indigo-800 mb-2">איך להשיג מפתחות API מלינט:</h4>
                                <ol className="text-sm text-indigo-700 space-y-1 mr-4">
                                    <li>1. היכנס למערכת לינט</li>
                                    <li>2. גש להגדרות &gt; ממשק API</li>
                                    <li>3. העתק את Login ID ו-Login Hash</li>
                                    <li>4. ודא שמזהה החברה נכון (מופיע ב-URL או בהגדרות)</li>
                                </ol>
                            </div>

                            <Button
                                onClick={handleLinetSave}
                                className="glass-button w-full"
                                style={{ background: '#4F46E5', color: 'white' }}
                                size="lg"
                            >
                                <Save className="w-4 h-4 ml-2" />
                                שמור הגדרות Linet
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="advanced" className="space-y-6 mt-6">
                    <div className="mb-4">
                        <h2 className="text-xl font-bold text-gray-900">הגדרות מתקדמות</h2>
                        <p className="text-sm text-gray-600 mt-1">הגדרות נוספות ופרמטרים טכניים</p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {settings.map((setting) => (
                            setting.setting_name !== 'RESEND_API_KEY' &&
                            setting.setting_name !== 'AUTO_REPLY_EMAIL' &&
                            setting.setting_name !== 'EMAIL_AUTOREPLY_TEMPLATE' &&
                            setting.setting_name !== 'REPAIR_RECEIPT_TERMS' &&
                            setting.setting_name !== 'WOOCOMMERCE_CONSUMER_KEY' &&
                            setting.setting_name !== 'WOOCOMMERCE_CONSUMER_SECRET' &&
                            setting.setting_name !== 'WOOCOMMERCE_SITE_URL' ?
                            (
                                <Card key={setting.id} className="glass-card border-0">
                                    <CardHeader>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <CardTitle className="text-lg" style={{ color: '#7D0F82' }}>{setting.setting_name}</CardTitle>
                                                <p className="text-sm text-gray-600 pt-1">{setting.notes}</p>
                                            </div>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="text-red-600 hover:bg-red-50"
                                                onClick={() => handleDeleteSetting(setting)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="flex items-center gap-2">
                                        {setting.setting_name.includes('AUTO_REPLY') ? (
                                            <Switch
                                                checked={setting.setting_value === "ON"}
                                                onCheckedChange={(checked) => {
                                                    const newValue = checked ? "ON" : "OFF";
                                                    handleSettingChange(setting.id, newValue);
                                                    handleUpdateSetting(setting.id, newValue);
                                                }}
                                            />
                                        ) : (
                                            <Input
                                                type="text"
                                                value={setting.setting_value}
                                                onChange={(e) => handleSettingChange(setting.id, e.target.value)}
                                                className="glass-button"
                                            />
                                        )}
                                        <Button
                                            size="icon"
                                            className="glass-button"
                                            onClick={() => handleUpdateSetting(setting.id, setting.setting_value)}
                                            style={{ background: '#7D0F82', color: 'white' }}
                                        >
                                            <Save className="w-4 h-4" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            ) : null
                        ))}
                    </div>

                    <Card className="glass-card border-0">
                        <CardHeader>
                            <CardTitle style={{ color: '#7D0F82' }}>הוספת הגדרה חדשה</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid md:grid-cols-3 gap-4">
                                <div>
                                    <Label htmlFor="new-setting-name">שם הגדרה</Label>
                                    <Input
                                        id="new-setting-name"
                                        value={newSetting.name}
                                        onChange={(e) => setNewSetting({ ...newSetting, name: e.target.value })}
                                        placeholder="SETTING_NAME"
                                        className="glass-button"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="new-setting-value">ערך</Label>
                                    <Input
                                        id="new-setting-value"
                                        value={newSetting.value}
                                        onChange={(e) => setNewSetting({ ...newSetting, value: e.target.value })}
                                        placeholder="ערך ההגדרה"
                                        className="glass-button"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="new-setting-notes">הערות</Label>
                                    <Input
                                        id="new-setting-notes"
                                        value={newSetting.notes}
                                        onChange={(e) => setNewSetting({ ...newSetting, notes: e.target.value })}
                                        placeholder="תיאור קצר"
                                        className="glass-button"
                                    />
                                </div>
                            </div>
                            <Button onClick={handleCreateSetting} className="glass-button" style={{ background: '#7D0F82', color: 'white' }}>
                                <Plus className="w-4 h-4 ml-2" />
                                הוסף הגדרה
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}