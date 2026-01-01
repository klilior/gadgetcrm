import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RefreshCcw, Plus, Pencil, Trash2, Building } from "lucide-react";
import { toast } from "sonner";
import { useUser } from "../components/UserAuth";

export default function SuppliersManagement() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(null); // null or supplier object
  const [form, setForm] = useState({ name: '', vat_id: '', aliases: '', notes: '', is_active: true });
  const [saving, setSaving] = useState(false);
  const { currentUser } = useUser();

  const canManage = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Suppliers.filter({}, '-created_date', 500);
      setSuppliers(list || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm({ name: '', vat_id: '', aliases: '', notes: '', is_active: true });
    setEditModal({ isNew: true });
  };

  const openEdit = (s) => {
    setForm({
      name: s.name || '',
      vat_id: s.vat_id || '',
      aliases: s.aliases || '',
      notes: s.notes || '',
      is_active: s.is_active !== false
    });
    setEditModal({ isNew: false, id: s.id });
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("שם ספק חובה");
      return;
    }
    setSaving(true);
    try {
      if (editModal.isNew) {
        await base44.entities.Suppliers.create(form);
        toast.success("ספק נוצר בהצלחה");
      } else {
        await base44.entities.Suppliers.update(editModal.id, form);
        toast.success("ספק עודכן בהצלחה");
      }
      setEditModal(null);
      load();
    } catch (e) {
      toast.error("שגיאה: " + (e?.message || "שגיאה"));
    } finally {
      setSaving(false);
    }
  };

  const deleteSupplier = async (id) => {
    if (!confirm("האם למחוק ספק זה?")) return;
    try {
      await base44.entities.Suppliers.delete(id);
      toast.success("ספק נמחק");
      load();
    } catch (e) {
      toast.error("שגיאה במחיקה");
    }
  };

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building className="w-6 h-6 text-indigo-600" />
          ניהול ספקים
        </h1>
        <div className="flex gap-2">
          {canManage && (
            <Button onClick={openNew} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
              <Plus className="w-4 h-4" />
              ספק חדש
            </Button>
          )}
          <Button variant="outline" onClick={load} className="gap-2">
            <RefreshCcw className="w-4 h-4" />
            רענן
          </Button>
        </div>
      </div>

      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle>רשימת ספקים ({suppliers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם ספק</TableHead>
                  <TableHead>ח.פ./עוסק</TableHead>
                  <TableHead>כינויים</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>מקור</TableHead>
                  <TableHead>הערות</TableHead>
                  {canManage && <TableHead>פעולות</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7}>טוען...</TableCell></TableRow>
                ) : suppliers.length === 0 ? (
                  <TableRow><TableCell colSpan={7}>אין ספקים</TableCell></TableRow>
                ) : (
                  suppliers.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="font-mono text-sm">{s.vat_id || "-"}</TableCell>
                      <TableCell className="text-sm text-gray-600">{s.aliases || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={s.is_active !== false ? "default" : "secondary"}>
                          {s.is_active !== false ? "פעיל" : "לא פעיל"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {s.created_from_invoice ? (
                          <Badge variant="outline" className="text-xs">מחשבונית</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-blue-50">ידני</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600 max-w-[200px] truncate">{s.notes || "-"}</TableCell>
                      {canManage && (
                        <TableCell className="space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => deleteSupplier(s.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editModal} onOpenChange={(open) => !open && setEditModal(null)}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editModal?.isNew ? "ספק חדש" : "עריכת ספק"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>שם ספק *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>ח.פ./עוסק מורשה (לזיהוי אוטומטי)</Label>
              <Input value={form.vat_id} onChange={e => setForm({ ...form, vat_id: e.target.value })} placeholder="9 ספרות" />
              <p className="text-xs text-gray-500">חשוב: המערכת מזהה ספקים אוטומטית לפי ח.פ. מהחשבונית</p>
            </div>
            <div className="space-y-1">
              <Label>כינויים נוספים</Label>
              <Input value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} placeholder="שמות חלופיים מופרדים בפסיק" />
            </div>
            <div className="space-y-1">
              <Label>הערות</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              <Label>ספק פעיל</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditModal(null)}>ביטול</Button>
              <Button onClick={save} disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}