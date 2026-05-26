import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Send, MessageSquare } from "lucide-react";

const KEYS = {
  enabled: "gadget_team_sms_enabled",
  phone: "gadget_team_sms_phone",
  template: "gadget_team_sms_template",
};

const DEFAULT_TEMPLATE = "תיקון חדש מ-GADGET-TEAM:\nדגם: {device_model}\nתקלות: {issues}\nהצעת מחיר: ₪{price}\nמספר תיקון: {repair_id}";

export default function GadgetTeamSmsSettings() {
  const [settings, setSettings] = useState({});
  const [enabled, setEnabled] = useState(true);
  const [phone, setPhone] = useState("0506675766");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const all = await base44.entities.Settings.filter({});
    const map = {};
    all.forEach(s => { map[s.setting_name] = s; });
    setSettings(map);
    
    if (map[KEYS.enabled]) setEnabled(map[KEYS.enabled].setting_value === "true");
    if (map[KEYS.phone]) setPhone(map[KEYS.phone].setting_value || "");
    if (map[KEYS.template]) setTemplate(map[KEYS.template].setting_value || DEFAULT_TEMPLATE);
    setLoading(false);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updates = [
        { key: KEYS.enabled, value: enabled ? "true" : "false" },
        { key: KEYS.phone, value: phone },
        { key: KEYS.template, value: template },
      ];
      for (const u of updates) {
        if (settings[u.key]) {
          await base44.entities.Settings.update(settings[u.key].id, { setting_value: u.value });
        } else {
          await base44.entities.Settings.create({ setting_name: u.key, setting_value: u.value });
        }
      }
      await loadSettings();
      setMessage({ type: "success", text: "ההגדרות נשמרו בהצלחה" });
    } catch (e) {
      setMessage({ type: "error", text: "שגיאה: " + e.message });
    }
    setSaving(false);
  };

  const sendTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const testMsg = template
        .replace(/\{device_model\}/g, "Apple אייפון 15 Pro")
        .replace(/\{issues\}/g, "מסך - מסך שבור")
        .replace(/\{price\}/g, "350")
        .replace(/\{repair_id\}/g, "TEST-001")
        .replace(/\{issue_category\}/g, "מסך")
        .replace(/\{issue_description\}/g, "מסך שבור");

      const { data } = await base44.functions.invoke("sendTextMeSMS", {
        action: "send",
        to_phone: phone,
        message: testMsg,
        event_type: "gadget_team_test",
        fingerprint: `gadget_team_test|${Date.now()}`,
      });
      
      if (data?.success) {
        setMessage({ type: "success", text: "הודעת טסט נשלחה בהצלחה!" });
      } else {
        setMessage({ type: "error", text: "שליחה נכשלה: " + (data?.error || "שגיאה") });
      }
    } catch (e) {
      setMessage({ type: "error", text: "שגיאה: " + e.message });
    }
    setTesting(false);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-purple-600" />
          SMS למעבדת Gadget-Team
        </CardTitle>
        <CardDescription>
          שליחת SMS אוטומטית לבעל המעבדה כשנכנס תיקון מסוג מעבדת Gadget-Team
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label>{enabled ? "פעיל" : "מושבת"}</Label>
        </div>

        <div>
          <Label className="mb-1 block">מספר טלפון</Label>
          <Input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="05XXXXXXXX"
            dir="ltr"
            className="max-w-xs"
          />
        </div>

        <div>
          <Label className="mb-1 block">תבנית הודעה</Label>
          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            className="w-full h-32 border rounded-lg p-3 text-sm font-mono resize-y"
            dir="rtl"
          />
          <p className="text-xs text-gray-500 mt-1">
            משתנים זמינים: <code>{"{device_model}"}</code> <code>{"{issues}"}</code> <code>{"{price}"}</code> <code>{"{repair_id}"}</code> <code>{"{issue_category}"}</code> <code>{"{issue_description}"}</code>
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-gray-600 mb-1">תצוגה מקדימה:</p>
          <p className="text-sm whitespace-pre-wrap">
            {template
              .replace(/\{device_model\}/g, "Apple אייפון 15 Pro")
              .replace(/\{issues\}/g, "מסך - מסך שבור")
              .replace(/\{price\}/g, "350")
              .replace(/\{repair_id\}/g, "REP-001")
              .replace(/\{issue_category\}/g, "מסך")
              .replace(/\{issue_description\}/g, "מסך שבור")}
          </p>
        </div>

        {message && (
          <div className={`text-sm px-3 py-2 rounded-lg ${
            message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />}
            שמור הגדרות
          </Button>
          <Button variant="outline" onClick={sendTest} disabled={testing || !phone}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Send className="w-4 h-4 ml-1" />}
            שלח הודעת טסט
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}