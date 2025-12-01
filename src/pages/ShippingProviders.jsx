import React, { useState, useEffect } from "react";
import { ShippingProvider } from "@/entities/all";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Truck, Plus, Settings, Check, X, Zap } from "lucide-react";

export default function ShippingProvidersPage() {
    const [providers, setProviders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingProvider, setEditingProvider] = useState(null);
    const [testResult, setTestResult] = useState(null);

    useEffect(() => {
        loadProviders();
    }, []);

    const loadProviders = async () => {
        setIsLoading(true);
        try {
            const data = await ShippingProvider.list();
            setProviders(data);
        } catch (error) {
            console.error("Error loading providers:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleActive = async (provider) => {
        try {
            await ShippingProvider.update(provider.id, {
                is_active: !provider.is_active
            });
            loadProviders();
        } catch (error) {
            console.error("Error toggling provider:", error);
            alert("שגיאה בעדכון הספק");
        }
    };

    const handleTestConnection = async (provider) => {
        if (provider.provider_type !== 'velo') {
            alert("בדיקת חיבור זמינה רק ל-Velo");
            return;
        }

        setTestResult({ loading: true });
        
        try {
            const { data } = await base44.functions.invoke('testVeloAuth');
            setTestResult(data);
        } catch (error) {
            setTestResult({
                success: false,
                error: 'שגיאת רשת',
                details: error.message
            });
        }
    };

    if (isLoading) {
        return <div className="p-6 text-center">טוען ספקים...</div>;
    }

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">ספקי משלוחים</h1>
                <Button 
                    onClick={() => setShowAddModal(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                >
                    <Plus className="w-4 h-4 ml-2" />
                    הוסף ספק
                </Button>
            </div>

            {testResult && (
                <Card className={testResult.success ? "border-green-500 bg-green-50" : "border-red-500 bg-red-50"}>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            <span>{testResult.success ? "✅ החיבור תקין" : "❌ החיבור נכשל"}</span>
                            <Button variant="ghost" size="sm" onClick={() => setTestResult(null)}>×</Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {testResult.loading ? (
                            <p>בודק חיבור...</p>
                        ) : testResult.success ? (
                            <div className="space-y-2">
                                <p className="font-medium text-green-800">ההתחברות הצליחה!</p>
                                <div className="text-sm space-y-1">
                                    <p>• JWT Length: {testResult.jwt_length}</p>
                                    <p>• Expiry: {testResult.expiry} שניות</p>
                                    {testResult.message && <p>• {testResult.message}</p>}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <p className="font-medium text-red-800">שגיאה: {testResult.error}</p>
                                {testResult.status && <p className="text-sm">• Status Code: {testResult.status}</p>}
                                {testResult.hint && <p className="text-sm text-red-700 font-medium">💡 {testResult.hint}</p>}
                                {testResult.details && (
                                    <details className="text-sm">
                                        <summary className="cursor-pointer font-medium">פרטי הבדיקה</summary>
                                        <pre className="mt-2 p-3 bg-white rounded text-xs overflow-auto" dir="ltr">
                                            {typeof testResult.details === 'object' 
                                                ? JSON.stringify(testResult.details, null, 2)
                                                : testResult.details}
                                        </pre>
                                    </details>
                                )}
                                {testResult.response && (
                                    <details className="text-sm">
                                        <summary className="cursor-pointer font-medium">תגובת השרת</summary>
                                        <pre className="mt-2 p-3 bg-white rounded text-xs overflow-auto" dir="ltr">
                                            {typeof testResult.response === 'object'
                                                ? JSON.stringify(testResult.response, null, 2)
                                                : testResult.response}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4">
                {providers.map(provider => (
                    <Card key={provider.id} className="glass-card border-0">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${
                                        provider.is_active 
                                            ? 'bg-green-100 text-green-600' 
                                            : 'bg-gray-100 text-gray-600'
                                    }`}>
                                        <Truck className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-lg font-semibold">{provider.name}</h3>
                                            {provider.is_active && (
                                                <Badge className="bg-green-100 text-green-800">פעיל</Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600">
                                            {provider.provider_type === 'velo' ? 'Velo' : 'אחר'}
                                        </p>
                                        {provider.supported_carriers && provider.supported_carriers.length > 0 && (
                                            <p className="text-xs text-gray-500 mt-1">
                                                חברות נתמכות: {provider.supported_carriers.join(', ')}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {provider.provider_type === 'velo' && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleTestConnection(provider)}
                                            className="gap-2"
                                        >
                                            <Zap className="w-4 h-4" />
                                            בדוק חיבור
                                        </Button>
                                    )}
                                    <Switch
                                        checked={provider.is_active}
                                        onCheckedChange={() => handleToggleActive(provider)}
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => setEditingProvider(provider)}
                                    >
                                        <Settings className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {providers.length === 0 && (
                    <Card className="glass-card border-0">
                        <CardContent className="p-12 text-center text-gray-500">
                            <Truck className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p>אין ספקי משלוחים במערכת</p>
                            <p className="text-sm mt-2">לחץ על "הוסף ספק" כדי להתחיל</p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {showAddModal && (
                <AddProviderModal
                    onClose={() => setShowAddModal(false)}
                    onSuccess={loadProviders}
                />
            )}

            {editingProvider && (
                <EditProviderModal
                    provider={editingProvider}
                    onClose={() => setEditingProvider(null)}
                    onSuccess={loadProviders}
                />
            )}
        </div>
    );
}

function AddProviderModal({ onClose, onSuccess }) {
    const [providerName, setProviderName] = useState("");
    const [selectedUiType, setSelectedUiType] = useState("auto-velo"); // New state for UI selection
    const [veloApiKey, setVeloApiKey] = useState(""); // New state for Velo API key
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            let payload = {};

            if (selectedUiType === "auto-velo") {
                if (!veloApiKey) {
                    alert("נא להזין מפתח API של Velo");
                    setIsSaving(false);
                    return;
                }
                const res = await base44.post('/api/velo/setup', { apiKey: veloApiKey });
                payload = { ...res.data, is_active: false }; // Use data from Velo setup endpoint
            } else { // Manual Velo or Other
                if (!providerName) {
                    alert("נא להזין שם ספק");
                    setIsSaving(false);
                    return;
                }
                const actualProviderType = selectedUiType === "manual-velo" ? "velo" : "other";
                payload = {
                    name: providerName,
                    provider_type: actualProviderType,
                    is_active: false,
                    config: {},
                    supported_carriers: []
                };
            }

            await ShippingProvider.create(payload);
            onSuccess();
            onClose();
        } catch (error) {
            console.error("Error creating provider:", error);
            alert(`שגיאה ביצירת ספק: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
            <Card className="w-full max-w-md m-4">
                <CardHeader>
                    <CardTitle>הוסף ספק משלוחים</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label>סוג הגדרה</Label>
                        <select
                            value={selectedUiType}
                            onChange={(e) => setSelectedUiType(e.target.value)}
                            className="w-full p-2 border rounded-lg"
                        >
                            <option value="auto-velo">הגדרת Velo אוטומטית</option>
                            <option value="manual-velo">Velo ידני</option>
                            <option value="other">ספק אחר</option>
                        </select>
                    </div>

                    {selectedUiType === "auto-velo" ? (
                        <>
                            <div>
                                <Label htmlFor="veloApiKey">מפתח API של Velo</Label>
                                <Input
                                    id="veloApiKey"
                                    value={veloApiKey}
                                    onChange={(e) => setVeloApiKey(e.target.value)}
                                    placeholder="הזן את מפתח ה-API שלך מ-Velo"
                                />
                                <p className="text-sm text-gray-500 mt-1">
                                    Velo תוגדר אוטומטית על סמך המפתח.
                                </p>
                            </div>
                            <div>
                                <Label>שם הספק</Label>
                                <Input
                                    value="Velo (אוטומטי)"
                                    disabled
                                    className="bg-gray-100"
                                />
                                <p className="text-sm text-gray-500 mt-1">
                                    שם הספק ופרטים נוספים יוגדרו אוטומטית.
                                </p>
                            </div>
                        </>
                    ) : (
                        <div>
                            <Label htmlFor="providerName">שם הספק</Label>
                            <Input
                                id="providerName"
                                value={providerName}
                                onChange={(e) => setProviderName(e.target.value)}
                                placeholder={selectedUiType === "manual-velo" ? "לדוגמה: Velo" : "לדוגמה: UPS"}
                            />
                        </div>
                    )}
                    
                    <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={onClose} disabled={isSaving}>
                            ביטול
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? "שומר..." : "שמור"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function EditProviderModal({ provider, onClose, onSuccess }) {
    const isVelo = provider.provider_type === 'velo';
    
    // Velo-specific fields
    const [apiKey, setApiKey] = useState(provider.config?.apiKey || '');
    const [apiSecret, setApiSecret] = useState(provider.config?.apiSecret || '');
    const [email, setEmail] = useState(provider.config?.email || '');
    const [password, setPassword] = useState(provider.config?.password || '');
    
    // Generic config field (if not Velo) - REMOVED, will be empty object
    // const [configString, setConfigString] = useState(JSON.stringify(provider.config || {}, null, 2));

    // General fields for all types
    const [apiUrl, setApiUrl] = useState(provider.api_url || '');
    const [carriers, setCarriers] = useState((provider.supported_carriers || []).join(', '));
    const [notes, setNotes] = useState(provider.notes || '');
    
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updateData = {
                supported_carriers: carriers.split(',').map(c => c.trim()).filter(c => c),
                notes: notes.trim()
            };

            if (isVelo) {
                updateData.config = {
                    apiKey: apiKey.trim(),
                    apiSecret: apiSecret.trim(),
                    email: email.trim(),
                    password: password.trim(),
                    baseUrl: 'https://api.veloapp.io/api/enterprise'
                };
                updateData.api_url = 'https://api.veloapp.io/api/enterprise'; // Velo's API URL is fixed
            } else { // Not Velo, config will be an empty object based on outline
                updateData.config = {}; // Removed generic config JSON field
                updateData.api_url = apiUrl.trim(); // Non-Velo API URL is editable
            }
            
            await ShippingProvider.update(provider.id, updateData);
            alert('✅ הספק עודכן בהצלחה!');
            onSuccess();
            onClose();
        } catch (error) {
            console.error("Error updating provider:", error);
            alert(`❌ שגיאה בעדכון ספק: ${error.response?.data?.message || error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
            <div className="bg-white w-full max-w-2xl m-4 max-h-[90vh] overflow-y-auto rounded-3xl">
                <div className="sticky top-0 bg-white border-b p-6 flex justify-between items-center">
                    <h2 className="text-2xl font-bold">עריכת ספק: {provider.name}</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>
                
                <div className="p-6 space-y-4">
                    {isVelo && (
                        <div className="bg-blue-50 p-4 rounded-lg space-y-3">
                            <h3 className="font-semibold text-blue-900">🔐 פרטי התחברות Velo</h3>
                            
                            <div>
                                <Label>API Key *</Label>
                                <Input
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="opVgjXXLddJBM00FG1VK"
                                    className="font-mono"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    מ-Velo Dashboard → Settings → API
                                </p>
                            </div>
                            
                            <div>
                                <Label>API Secret *</Label>
                                <Input
                                    type="password"
                                    value={apiSecret}
                                    onChange={(e) => setApiSecret(e.target.value)}
                                    placeholder="VWdrY18rbW7FSxV2osgR"
                                    className="font-mono"
                                />
                            </div>
                            
                            <div>
                                <Label>Email *</Label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="your-email@example.com"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    האימייל שאיתו נרשמת ל-Velo
                                </p>
                            </div>
                            
                            <div>
                                <Label>סיסמה *</Label>
                                <Input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    הסיסמה שלך ב-Velo
                                </p>
                            </div>

                            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm">
                                <p className="font-semibold text-yellow-800">💡 איפה למצוא:</p>
                                <ol className="list-decimal list-inside space-y-1 text-yellow-700 mt-2">
                                    <li>התחבר ל-Velo: <a href="https://app.veloapp.io" target="_blank" rel="noopener noreferrer" className="underline">app.veloapp.io</a></li>
                                    <li>לך ל-Settings → API</li>
                                    <li>העתק את ה-API Key וה-Secret</li>
                                </ol>
                            </div>
                        </div>
                    )}
                    
                    <div>
                        <Label>כתובת API</Label>
                        <Input
                            value={isVelo ? 'https://api.veloapp.io/api/enterprise' : apiUrl}
                            onChange={(e) => setApiUrl(e.target.value)}
                            placeholder="https://api.velo.co.il/..."
                            disabled={isVelo}
                            className={isVelo ? 'bg-gray-100' : ''}
                        />
                        {isVelo && (
                            <p className="text-xs text-gray-500 mt-1">
                                נקבע אוטומטית ל-Velo
                            </p>
                        )}
                    </div>
                    
                    <div>
                        <Label>חברות משלוח נתמכות (מופרדות בפסיק)</Label>
                        <Input
                            value={carriers}
                            onChange={(e) => setCarriers(e.target.value)}
                            placeholder="באליקספרס, UPS, DHL"
                        />
                    </div>

                    {/* The following block for generic config JSON is removed based on the outline's changes to handleSave,
                        which now sets updateData.config = {}; for non-Velo providers.
                    {!isVelo && ( 
                        <div>
                            <Label>הגדרות (JSON)</Label>
                            <textarea
                                value={configString}
                                onChange={(e) => setConfigString(e.target.value)}
                                className="w-full h-64 p-3 border rounded-lg font-mono text-sm"
                                placeholder='{&#10;  "api_key": "your-key",&#10;  "api_secret": "your-secret"&#10;}'
                            />
                        </div>
                    )}
                    */}

                    <div>
                        <Label>הערות</Label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full h-24 p-3 border rounded-lg"
                            placeholder="הערות נוספות..."
                        />
                    </div>
                    
                    <div className="flex justify-end gap-2 pt-4 sticky bottom-0 bg-white border-t mt-4">
                        <Button variant="outline" onClick={onClose} disabled={isSaving}>
                            ביטול
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                            {isSaving ? "שומר..." : "💾 שמור"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}