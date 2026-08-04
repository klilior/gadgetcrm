import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, FileText, Edit, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SmsTemplatesManager() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const emptyForm = { template_key: "", hebrew_template: "", is_active: true };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    const all = await base44.entities.NotificationTemplate.list("-created_date", 100);
    setTemplates(all || []);
    setLoading(false);
  };

  const handleSave = async () => {
    if (!form.template_key || !form.hebrew_template) {
      toast.error("מפתח ותוכן הם שדות חובה");
      return;
    }
    if (editingId) {
      await base44.entities.NotificationTemplate.update(editingId, form);
      toast.success("תבנית עודכנה");
    } else {
      await base44.entities.NotificationTemplate.create({ ...form, channel: "SMS" });
      toast.success("תבנית נוספה");
    }
    setForm(emptyForm);
    setEditingId(null);
    setShowAdd(false);
    loadTemplates();
  };

  const handleEdit = (t) => {
    setEditingId(t.id);
    setForm({ template_key: t.template_key, hebrew_template: t.hebrew_template, is_active: t.is_active !== false });
    setShowAdd(true);
  };

  const handleDelete = async (t) => {
    if (!confirm(`למחוק את התבנית "${t.template_key}"?`)) return;
    await base44.entities.NotificationTemplate.delete(t.id);
    toast.success("תבנית נמחקה");
    loadTemplates();
  };

  const handleToggle = async (t) => {
    await base44.entities.NotificationTemplate.update(t.id, { is_active: !t.is_active });
    loadTemplates();
  };

  const handleCancel = () => {
    setShowAdd(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  if (loading) return <div className="text-center py-8 text-gray-400">טוען תבניות...</div>;

  return (
    <div className="space-y-4">
      <Card className="border-2 border-purple-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-purple-700 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              תבניות הודעות SMS ({templates.length})
            </CardTitle>
            {!showAdd && (
              <Button onClick={() => { setShowAdd(true); setEditingId(null); setForm(emptyForm); }} size="sm" className="bg-purple-600 hover:bg-purple-700 text-white">
                <Plus className="w-4 h-4 ml-1" />
                תבנית חדשה
              </Button>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            תבניות מוכנות לשליחת SMS מהירה. השתמש ב-{"{שם_משתנה}"} להחלפה דינמית.
          </p>
          <div className="mt-2 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
            <p className="font-semibold mb-1">📦 תבניות הודעות מעקב משלוח:</p>
            <p>המערכת מחפשת תבנית לפי חברת המשלוח ואז נופלת לברירת מחדל:</p>
            <p className="mt-1 font-mono">tracking_sms_cargo · tracking_sms_ups · tracking_sms_getpackage · tracking_sms_velo · tracking_sms_default</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add/Edit Form */}
          {showAdd && (
            <div className="border-2 border-dashed border-purple-300 rounded-xl p-4 space-y-3 bg-purple-50/50">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-purple-800">{editingId ? "עריכת תבנית" : "תבנית חדשה"}</h4>
                <Button variant="ghost" size="icon" onClick={handleCancel}><X className="w-4 h-4" /></Button>
              </div>
              <div>
                <Label>מפתח תבנית (ייחודי) *</Label>
                <Input
                  value={form.template_key}
                  onChange={e => setForm({ ...form, template_key: e.target.value })}
                  placeholder="repair_ready, order_shipped..."
                  className="mt-1"
                />
              </div>
              <div>
                <Label>תוכן ההודעה *</Label>
                <Textarea
                  value={form.hebrew_template}
                  onChange={e => setForm({ ...form, hebrew_template: e.target.value })}
                  placeholder="שלום {customer_name}, תיקון #{repair_id} מוכן לאיסוף..."
                  rows={4}
                  className="mt-1"
                  dir="rtl"
                />
                <p className="text-xs text-gray-400 mt-1">{form.hebrew_template.length}/1005 תווים</p>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
                  <Label>פעילה</Label>
                </div>
                <div className="flex gap-2 mr-auto">
                  <Button variant="outline" onClick={handleCancel}>ביטול</Button>
                  <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700 text-white">
                    <Save className="w-4 h-4 ml-1" />
                    {editingId ? "עדכן" : "שמור"}
                  </Button>
                </div>
              </div>

              {/* Common variables */}
              <div className="bg-white rounded-lg p-3 text-xs text-gray-500">
                <p className="font-semibold mb-1">משתנים נפוצים:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["{customer_name}", "{phone}", "{repair_id}", "{status}", "{device}", "{final_price}", "{order_number}", "{first_name}", "{tracking_number}", "{carrier_name}", "{tracking_url}", "{tracking_url_block}", "{order_number_text}", "{delivery_note}"].map(v => (
                    <code key={v} className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded cursor-pointer hover:bg-purple-200"
                      onClick={() => setForm({ ...form, hebrew_template: form.hebrew_template + " " + v })}>
                      {v}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Templates List */}
          {templates.length === 0 && !showAdd && (
            <div className="text-center py-8 text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-40" />
              <p>אין תבניות. לחץ "תבנית חדשה" כדי להתחיל.</p>
            </div>
          )}

          {templates.map(t => (
            <div key={t.id} className={`border rounded-xl p-4 ${t.is_active ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800">{t.template_key}</span>
                  <Badge className={t.is_active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}>
                    {t.is_active ? "פעילה" : "מושבתת"}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleToggle(t)} className="h-8 w-8">
                    <span className={`text-xs ${t.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                      {t.is_active ? "⏸" : "▶"}
                    </span>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(t)} className="h-8 w-8">
                    <Edit className="w-3.5 h-3.5 text-blue-600" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(t)} className="h-8 w-8">
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>
              </div>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{t.hebrew_template}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}