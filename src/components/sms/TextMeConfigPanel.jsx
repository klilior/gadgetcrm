import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Send, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendTextMeSMS } from "@/functions/sendTextMeSMS";

export default function TextMeConfigPanel() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("הודעת בדיקה מ-Gadget Team");
  const [testing, setTesting] = useState(false);

  const [form, setForm] = useState({
    username: "", default_source: "", is_enabled: true, test_mode: false,
    rate_limit_per_minute: 10, allowed_hours_start: "08:00", allowed_hours_end: "22:00",
    admin_phones: "",
  });

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    const configs = await base44.entities.TextMeConfig.list('-created_date', 1);
    if (configs?.length) {
      const c = configs[0];
      setConfig(c);
      setForm({
        username: c.username || "",
        default_source: c.default_source || "",
        is_enabled: c.is_enabled !== false,
        test_mode: c.test_mode === true,
        rate_limit_per_minute: c.rate_limit_per_minute || 10,
        allowed_hours_start: c.allowed_hours_start || "08:00",
        allowed_hours_end: c.allowed_hours_end || "22:00",
        admin_phones: c.admin_phones || "",
      });
    }
    setLoading(false);
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.username || !form.default_source) {
      toast.error("שם משתמש ושם שולח הם שדות חובה");
      return;
    }
    setSaving(true);
    const data = { ...form, rate_limit_per_minute: parseInt(form.rate_limit_per_minute) || 10 };
    if (config) {
      await base44.entities.TextMeConfig.update(config.id, data);
    } else {
      await base44.entities.TextMeConfig.create(data);
    }
    toast.success("הגדרות TextMe נשמרו");
    await loadConfig();
    setSaving(false);
  };

  const handleTest = async () => {
    if (!testPhone) { toast.error("הזן טלפון לבדיקה"); return; }
    setTesting(true);
    try {
      const res = await sendTextMeSMS({ action: "test", to_phone: testPhone, message: testMsg });
      const data = res.data || res;
      if (data.success) {
        toast.success(`בדיקה נשלחה בהצלחה (test endpoint)\n${data.provider_response || ""}`);
      } else {
        toast.error(`שגיאה: ${data.error || data.provider_response || "unknown"}`);
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    }
    setTesting(false);
  };

  if (loading) return <div className="text-center py-8 text-gray-400">טוען...</div>;

  return (
    <div className="space-y-6">
      <Card className="border-2 border-teal-200">
        <CardHeader>
          <CardTitle className="text-teal-700 flex items-center gap-2">
            <Send className="w-5 h-5" />
            הגדרות TextMe SMS
          </CardTitle>
          <p className="text-sm text-gray-500 mt-1">הגדרת חשבון TextMe לשליחת הודעות SMS אוטומטיות</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>שם משתמש TextMe *</Label>
              <Input value={form.username} onChange={e => set("username", e.target.value)} placeholder="username" />
            </div>
            <div>
              <Label>שם שולח ברירת מחדל *</Label>
              <Input value={form.default_source} onChange={e => set("default_source", e.target.value)} placeholder="GadgetTeam" maxLength={11} />
              <p className="text-[10px] text-gray-400 mt-1">עד 11 תווים, אנגלית/מספרים בלבד</p>
            </div>
          </div>

          <div>
            <Label>טלפונים לקבלת התראות (מופרדים בפסיק)</Label>
            <Input value={form.admin_phones} onChange={e => set("admin_phones", e.target.value)} placeholder="0501234567, 0529876543" dir="ltr" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>שעת התחלה</Label>
              <Input type="time" value={form.allowed_hours_start} onChange={e => set("allowed_hours_start", e.target.value)} />
            </div>
            <div>
              <Label>שעת סיום</Label>
              <Input type="time" value={form.allowed_hours_end} onChange={e => set("allowed_hours_end", e.target.value)} />
            </div>
            <div>
              <Label>מגבלת שליחות/דקה</Label>
              <Input type="number" value={form.rate_limit_per_minute} onChange={e => set("rate_limit_per_minute", e.target.value)} min={1} max={100} />
            </div>
          </div>

          <div className="flex items-center gap-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <Switch checked={form.is_enabled} onCheckedChange={v => set("is_enabled", v)} />
              <Label>שירות פעיל</Label>
              <Badge className={form.is_enabled ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                {form.is_enabled ? "פעיל" : "מושבת"}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.test_mode} onCheckedChange={v => set("test_mode", v)} />
              <Label>מצב בדיקה</Label>
              {form.test_mode && <Badge className="bg-amber-100 text-amber-700">TEST</Badge>}
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full bg-teal-600 hover:bg-teal-700 text-white">
            {saving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
            שמור הגדרות
          </Button>
        </CardContent>
      </Card>

      {/* Test Send */}
      <Card className="border-2 border-amber-200">
        <CardHeader>
          <CardTitle className="text-amber-700 flex items-center gap-2">
            <Send className="w-5 h-5" />
            שליחת הודעת בדיקה
          </CardTitle>
          <p className="text-sm text-gray-500">שולח תמיד ל-endpoint הבדיקה של TextMe</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>טלפון</Label>
              <Input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="0501234567" dir="ltr" />
            </div>
            <div>
              <Label>הודעה</Label>
              <Input value={testMsg} onChange={e => setTestMsg(e.target.value)} />
            </div>
          </div>
          <Button onClick={handleTest} disabled={testing} variant="outline" className="w-full">
            {testing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Send className="w-4 h-4 ml-2" />}
            שלח בדיקה
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}