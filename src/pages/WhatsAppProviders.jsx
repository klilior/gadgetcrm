import React, { useState, useEffect } from "react";
import { WhatsappProvider } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Settings, Trash2, CheckCircle, AlertTriangle, MessageSquare, Copy, ExternalLink, Info } from "lucide-react";
import { toast } from "sonner";

export default function WhatsAppProvidersPage() {
    const [providers, setProviders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [editingProvider, setEditingProvider] = useState(null);
    const [newProvider, setNewProvider] = useState({
        name: "",
        provider_type: "green-api",
        config: {},
        phone_number: "",
        notes: ""
    });
    const [showWebhookHelp, setShowWebhookHelp] = useState(false);

    useEffect(() => {
        loadProviders();
    }, []);

    const loadProviders = async () => {
        setIsLoading(true);
        const data = await WhatsappProvider.list("-updated_date");
        setProviders(data);
        setIsLoading(false);
    };

    const handleProviderToggle = async (providerId, isActive) => {
        if (isActive) {
            const updates = providers.map(p => 
                p.id === providerId 
                    ? WhatsappProvider.update(p.id, { is_active: true })
                    : WhatsappProvider.update(p.id, { is_active: false })
            );
            await Promise.all(updates);
        } else {
            await WhatsappProvider.update(providerId, { is_active: false });
        }
        loadProviders();
    };

    const handleSaveProvider = async () => {
        if (!newProvider.name || !newProvider.name.trim()) {
            toast.error('נא להזין שם ספק');
            return;
        }

        if (!newProvider.phone_number || !newProvider.phone_number.trim()) {
            toast.error('נא להזין מספר טלפון');
            return;
        }

        setIsSaving(true);

        try {
            console.log('💾 Saving provider...', newProvider);

            let configObj = newProvider.config;
            if (typeof configObj === 'string') {
                try {
                    configObj = JSON.parse(configObj);
                } catch (e) {
                    toast.error('פורמט JSON לא תקין בהגדרות');
                    setIsSaving(false);
                    return;
                }
            }

            const providerData = {
                name: newProvider.name.trim(),
                provider_type: newProvider.provider_type,
                config: configObj,
                phone_number: newProvider.phone_number.trim(),
                notes: newProvider.notes || "",
                is_active: editingProvider && editingProvider.id ? editingProvider.is_active : false
            };

            console.log('📤 Provider data to save:', providerData);

            if (editingProvider && editingProvider.id) {
                console.log('✏️ Updating provider:', editingProvider.id);
                await WhatsappProvider.update(editingProvider.id, providerData);
                toast.success('✅ הספק עודכן בהצלחה!');
            } else {
                console.log('➕ Creating new provider');
                await WhatsappProvider.create(providerData);
                toast.success('✅ הספק נוצר בהצלחה!');
            }

            setEditingProvider(null);
            setNewProvider({
                name: "",
                provider_type: "green-api",
                config: {},
                phone_number: "",
                notes: ""
            });

            await loadProviders();

        } catch (error) {
            console.error('❌ Error saving provider:', error);
            toast.error(`שגיאה בשמירת הספק: ${error.message || 'שגיאה לא ידועה'}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditProvider = (provider) => {
        setEditingProvider(provider);
        setNewProvider({
            ...provider,
            config: JSON.stringify(provider.config, null, 2)
        });
    };

    const handleDeleteProvider = async (provider) => {
        if (window.confirm(`האם אתה בטוח שברצונך למחוק את ספק ${provider.name}?`)) {
            await WhatsappProvider.delete(provider.id);
            loadProviders();
        }
    };

    const getProviderTypeConfig = (type) => {
        switch (type) {
            case 'green-api':
                return {
                    name: 'Green API',
                    fields: [
                        { key: 'idInstance', label: 'מזהה מכשיר (ID Instance)', placeholder: '1101234567' },
                        { key: 'apiTokenInstance', label: 'טוקן API', placeholder: 'abc123...' },
                        { key: 'baseUrl', label: 'כתובת בסיס', placeholder: 'https://api.green-api.com' }
                    ]
                };
            case 'botit':
                return {
                    name: 'Bot.it',
                    fields: [
                        { key: 'apiKey', label: 'מפתח API (Token)', placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                        { key: 'senderPhone', label: 'מספר שולח (From)', placeholder: '972501234567' }
                    ]
                };
            default:
                return { name: 'Custom', fields: [] };
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        toast.success('הועתק ללוח');
    };

    const getWebhookUrl = () => {
        const baseUrl = window.location.origin;
        return `${baseUrl}/functions/botitWebhook`;
    };

    const renderConfigForm = (providerType, config) => {
        const typeConfig = getProviderTypeConfig(providerType);
        const configObj = typeof config === 'string' ? JSON.parse(config || '{}') : config;

        return (
            <div className="space-y-4">
                <h4 className="font-medium text-gray-700">הגדרות {typeConfig.name}</h4>
                {typeConfig.fields.map(field => (
                    <div key={field.key}>
                        <Label>{field.label}</Label>
                        <Input
                            value={configObj[field.key] || ''}
                            onChange={(e) => {
                                const updatedConfig = { ...configObj, [field.key]: e.target.value };
                                setNewProvider({ ...newProvider, config: updatedConfig });
                            }}
                            placeholder={field.placeholder}
                        />
                    </div>
                ))}
                
                {providerType === 'botit' && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-start gap-2 mb-3">
                            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <h5 className="font-semibold text-blue-900 mb-2">🔗 הגדרת Webhook ב-Bot.it</h5>
                                <p className="text-sm text-blue-800 mb-3">
                                    יש להעתיק את הכתובת הבאה ולהדביק אותה בהגדרות ה-Webhook ב-Bot.it:
                                </p>
                            </div>
                        </div>
                        
                        <div className="bg-white p-3 rounded border border-blue-300 font-mono text-sm flex items-center gap-2">
                            <code className="flex-1 break-all">{getWebhookUrl()}</code>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => copyToClipboard(getWebhookUrl())}
                                className="flex-shrink-0"
                            >
                                <Copy className="w-4 h-4" />
                            </Button>
                        </div>

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 w-full"
                            onClick={() => setShowWebhookHelp(!showWebhookHelp)}
                        >
                            {showWebhookHelp ? '🔼 הסתר' : '🔽 הצג'} הוראות מפורטות
                        </Button>

                        {showWebhookHelp && (
                            <div className="mt-4 space-y-3 text-sm text-blue-900">
                                <div className="bg-white p-3 rounded">
                                    <p className="font-semibold mb-2">📋 שלבי ההגדרה ב-Bot.it:</p>
                                    <ol className="list-decimal list-inside space-y-2">
                                        <li>היכנס לחשבון Bot.it שלך</li>
                                        <li>עבור ל-<strong>Settings → Webhooks</strong></li>
                                        <li>לחץ על <strong>+ Add Webhook</strong></li>
                                        <li>הדבק את ה-URL למעלה בשדה <strong>Webhook URL</strong></li>
                                        <li>בחר באירועים:
                                            <ul className="list-disc list-inside mr-6 mt-1">
                                                <li>✅ Message Received</li>
                                                <li>✅ Media Received</li>
                                            </ul>
                                        </li>
                                        <li>שמור את ההגדרות</li>
                                    </ol>
                                </div>

                                <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                                    <p className="font-semibold text-yellow-900 mb-1">⚠️ חשוב - פרמטרים נדרשים:</p>
                                    <ul className="list-disc list-inside space-y-1 text-yellow-800">
                                        <li><strong>Token</strong>: מפתח ה-API (JWT) מ-Bot.it</li>
                                        <li><strong>From</strong>: מספר השולח (מספר הטלפון במערכת) עם קידומת 972</li>
                                        <li><strong>To</strong>: מספר הנמען - מתווסף אוטומטית</li>
                                        <li><strong>messageType</strong>: text/image/video/audio/document</li>
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                <div>
                    <Label>הגדרות JSON מלאות</Label>
                    <Textarea
                        value={typeof config === 'string' ? config : JSON.stringify(config, null, 2)}
                        onChange={(e) => setNewProvider({ ...newProvider, config: e.target.value })}
                        rows={8}
                        className="font-mono text-sm"
                        placeholder='{"apiKey": "your-token", "senderPhone": "972501234567"}'
                    />
                </div>
            </div>
        );
    };

    if (isLoading) {
        return <div className="p-6 text-center">טוען ספקי וואטסאפ...</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold text-gray-900">ניהול ספקי וואטסאפ</h1>
                <Button onClick={() => setEditingProvider({})}>
                    <Plus className="w-4 h-4 mr-2" />
                    ספק חדש
                </Button>
            </div>

            {/* Active Providers */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {providers.map((provider) => (
                    <Card key={provider.id} className={`${provider.is_active ? 'ring-2 ring-green-500' : ''}`}>
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <MessageSquare className="w-5 h-5" />
                                        {provider.name}
                                        {provider.is_active && <Badge className="bg-green-100 text-green-800">פעיל</Badge>}
                                    </CardTitle>
                                    <p className="text-sm text-gray-600">{getProviderTypeConfig(provider.provider_type).name}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="icon" variant="ghost" onClick={() => handleEditProvider(provider)}>
                                        <Settings className="w-4 h-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" className="text-red-600" onClick={() => handleDeleteProvider(provider)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {provider.phone_number && (
                                    <p className="text-sm"><span className="font-medium">מספר:</span> {provider.phone_number}</p>
                                )}
                                {provider.notes && (
                                    <p className="text-sm text-gray-600">{provider.notes}</p>
                                )}
                                <div className="flex justify-between items-center pt-4">
                                    <span className="text-sm font-medium">ספק פעיל</span>
                                    <Switch
                                        checked={provider.is_active}
                                        onCheckedChange={(checked) => handleProviderToggle(provider.id, checked)}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Provider Form Modal/Card */}
            {editingProvider !== null && (
                <Card className="max-w-2xl mx-auto">
                    <CardHeader>
                        <CardTitle>{editingProvider.id ? 'עריכת ספק' : 'ספק וואטסאפ חדש'}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label>שם הספק *</Label>
                            <Input
                                value={newProvider.name}
                                onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                                placeholder={newProvider.provider_type === 'botit' ? "Bot.it Production" : "Green API Production"}
                            />
                        </div>

                        <div>
                            <Label>סוג ספק</Label>
                            <Select
                                value={newProvider.provider_type}
                                onValueChange={(value) => setNewProvider({ ...newProvider, provider_type: value, config: {} })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="green-api">Green API</SelectItem>
                                    <SelectItem value="botit">Bot.it</SelectItem>
                                    <SelectItem value="ultramsg">UltraMsg</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <Label>מספר טלפון *</Label>
                            <Input
                                value={newProvider.phone_number}
                                onChange={(e) => setNewProvider({ ...newProvider, phone_number: e.target.value })}
                                placeholder="972501234567"
                            />
                        </div>

                        {renderConfigForm(newProvider.provider_type, newProvider.config)}

                        <div>
                            <Label>הערות</Label>
                            <Textarea
                                value={newProvider.notes}
                                onChange={(e) => setNewProvider({ ...newProvider, notes: e.target.value })}
                                placeholder="הערות על הספק..."
                            />
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button 
                                variant="outline" 
                                onClick={() => setEditingProvider(null)}
                                disabled={isSaving}
                            >
                                ביטול
                            </Button>
                            <Button 
                                onClick={handleSaveProvider}
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <>
                                        <span className="animate-spin mr-2">⏳</span>
                                        שומר...
                                    </>
                                ) : (
                                    editingProvider.id ? 'עדכן' : 'צור'
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}