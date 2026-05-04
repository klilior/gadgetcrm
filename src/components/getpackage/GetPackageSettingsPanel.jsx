import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, CheckCircle, XCircle, Loader2, Truck, Wifi } from "lucide-react";
import { toast } from "sonner";
import { getPackageApi } from "@/functions/getPackageApi";

export default function GetPackageSettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [formData, setFormData] = useState({
    is_active: false,
    environment: "sandbox",
    sandbox_api_base_url: "https://sandbox-apiv2.getpackage.com",
    production_api_base_url: "https://apiv2.getpackage.com",
    api_token: "",
    business_name: "",
    default_pickup_name: "",
    default_pickup_phone: "",
    default_pickup_address: "",
    default_pickup_city: "",
    default_pickup_notes: "",
    send_tracking_sms: true,
    auto_create_only_when_ready: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tokenSet, setTokenSet] = useState(false);
  const [newToken, setNewToken] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { data } = await getPackageApi({ action: "getSettings" });
      if (data.settings) {
        setSettings(data.settings);
        setFormData(prev => ({
          ...prev,
          ...data.settings,
          api_token: "", // never show token
        }));
        setTokenSet(data.settings.api_token_set);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...formData };
      // Only send token if user entered a new one
      if (newToken.trim()) {
        payload.api_token = newToken.trim();
      } else {
        delete payload.api_token;
      }
      await getPackageApi({ action: "saveSettings", data: payload });
      toast.success("הגדרות GetPackage נשמרו בהצלחה");
      setNewToken("");
      loadSettings();
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרות: " + e.message);
    }
    setSaving(false);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const { data } = await getPackageApi({ action: "testConnection" });
      if (data.success) {
        toast.success(data.message || "החיבור ל-GetPackage תקין.");
      } else {
        toast.error(data.error || "החיבור ל-GetPackage נכשל.");
      }
    } catch (e) {
      toast.error("שגיאה בבדיקת חיבור: " + e.message);
    }
    setTesting(false);
  };

  const updateField = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          טוען הגדרות...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection + Status */}
      <Card className="border-2 border-emerald-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-700">
            <Truck className="w-5 h-5" />
            GetPackage — הגדרות חיבור
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Active Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <Label className="font-semibold text-lg">אינטגרציה פעילה</Label>
              <p className="text-sm text-gray-600">הפעל/כבה משלוחי GetPackage</p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(v) => updateField("is_active", v)}
            />
          </div>

          {/* Environment */}
          <div>
            <Label>סביבת עבודה</Label>
            <Select value={formData.environment} onValueChange={(v) => updateField("environment", v)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (בדיקות)</SelectItem>
                <SelectItem value="production">Production (פרודקשן)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* API URLs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>כתובת API Sandbox</Label>
              <Input
                value={formData.sandbox_api_base_url}
                onChange={(e) => updateField("sandbox_api_base_url", e.target.value)}
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label>כתובת API Production</Label>
              <Input
                value={formData.production_api_base_url}
                onChange={(e) => updateField("production_api_base_url", e.target.value)}
                className="mt-1 font-mono text-sm"
              />
            </div>
          </div>

          {/* API Token */}
          <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 space-y-2">
            <Label className="font-semibold">API Token</Label>
            <div className="flex items-center gap-2 mb-2">
              {tokenSet ? (
                <span className="flex items-center gap-1 text-sm text-green-700">
                  <CheckCircle className="w-4 h-4" /> Token הוזן
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-red-600">
                  <XCircle className="w-4 h-4" /> לא הוזן Token
                </span>
              )}
            </div>
            <Input
              type="password"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder={tokenSet ? "הזן Token חדש להחלפה..." : "הזן API Token"}
              className="font-mono text-sm"
            />
            <p className="text-xs text-yellow-700">ה-Token לא יוצג שוב אחרי שמירה.</p>
          </div>

          {/* Business Name */}
          <div>
            <Label>שם העסק</Label>
            <Input
              value={formData.business_name}
              onChange={(e) => updateField("business_name", e.target.value)}
              placeholder="GADGET-TEAM"
              className="mt-1"
            />
          </div>

          {/* Test + Save Buttons */}
          <div className="flex gap-3 pt-4">
            <Button onClick={handleTestConnection} disabled={testing} variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              {testing ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Wifi className="w-4 h-4 ml-2" />}
              בדוק חיבור
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Save className="w-4 h-4 ml-2" />}
              שמור הגדרות
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pickup Defaults */}
      <Card className="border-2 border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-700 text-base">כתובת איסוף ברירת מחדל</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>שם איש קשר</Label>
              <Input value={formData.default_pickup_name} onChange={(e) => updateField("default_pickup_name", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>טלפון</Label>
              <Input value={formData.default_pickup_phone} onChange={(e) => updateField("default_pickup_phone", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>כתובת (רחוב + מספר)</Label>
              <Input value={formData.default_pickup_address} onChange={(e) => updateField("default_pickup_address", e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>עיר</Label>
              <Input value={formData.default_pickup_city} onChange={(e) => updateField("default_pickup_city", e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>הערות לשליח (איסוף)</Label>
            <Textarea value={formData.default_pickup_notes} onChange={(e) => updateField("default_pickup_notes", e.target.value)} rows={2} className="mt-1" />
          </div>

          {/* SMS + Auto-create toggles */}
          <div className="flex flex-wrap gap-6 pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={formData.send_tracking_sms} onCheckedChange={(v) => updateField("send_tracking_sms", v)} />
              שלח SMS עם קישור מעקב ללקוח
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={formData.auto_create_only_when_ready} onCheckedChange={(v) => updateField("auto_create_only_when_ready", v)} />
              צור משלוח רק כשההזמנה מוכנה
            </label>
          </div>

          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white mt-3">
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Save className="w-4 h-4 ml-2" />}
            שמור הגדרות
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}