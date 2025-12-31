import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUser } from "../components/UserAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCcw } from "lucide-react";

export default function InvoicesToReview() {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const { currentUser } = useUser();
  const canApprove = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      const invoices = await base44.entities.Invoices.filter({ extraction_status: "ממתין לאימות" }, "-doc_date", 200);
      setRows(invoices || []);
      const sups = await base44.entities.Suppliers.list(200);
      const map = {};
      (sups || []).forEach((s) => { map[s.id] = s; });
      setSuppliers(map);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const d1 = a.doc_date ? new Date(a.doc_date).getTime() : 0;
      const d2 = b.doc_date ? new Date(b.doc_date).getTime() : 0;
      if (d2 !== d1) return d2 - d1;
      const c1 = a.created_date ? new Date(a.created_date).getTime() : 0;
      const c2 = b.created_date ? new Date(b.created_date).getTime() : 0;
      return c2 - c1;
    });
    return arr;
  }, [rows]);

  const openRecord = (row) => setSelected({ ...row });

  const saveRecord = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updatePayload = {
        supplier: selected.supplier || undefined,
        doc_type: selected.doc_type || undefined,
        doc_number: selected.doc_number || undefined,
        doc_date: selected.doc_date || undefined,
        currency: selected.currency || undefined,
        subtotal_before_vat: selected.subtotal_before_vat != null ? Number(selected.subtotal_before_vat) : undefined,
        vat_amount: selected.vat_amount != null ? Number(selected.vat_amount) : undefined,
        total_with_vat: selected.total_with_vat != null ? Number(selected.total_with_vat) : undefined,
        notes: selected.notes || undefined,
        source_intake: selected.source_intake || undefined,
      };
      await base44.entities.Invoices.update(selected.id, updatePayload);
      toast.success("נשמר בהצלחה");
      setSelected(null);
      load();
    } catch (e) {
      toast.error("שגיאה בשמירה: " + (e?.message || "שגיאה"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">חשבוניות לאימות</h1>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4"/>רענן</Button>
      </div>

      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle>רשימת חשבוניות ממתינות</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ספק</TableHead>
                  <TableHead>סוג מסמך</TableHead>
                  <TableHead>מספר מסמך</TableHead>
                  <TableHead>תאריך מסמך</TableHead>
                  <TableHead>סה״כ כולל מע״מ</TableHead>
                  <TableHead>מטבע</TableHead>
                  <TableHead>ציון ודאות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7}>טוען...</TableCell></TableRow>
                ) : sorted.length === 0 ? (
                  <TableRow><TableCell colSpan={7}>אין תוצאות</TableCell></TableRow>
                ) : (
                  sorted.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => openRecord(r)}>
                      <TableCell>{suppliers[r.supplier]?.name || r.supplier || "-"}</TableCell>
                      <TableCell>{r.doc_type || "-"}</TableCell>
                      <TableCell>{r.doc_number || "-"}</TableCell>
                      <TableCell>{r.doc_date || "-"}</TableCell>
                      <TableCell>{r.total_with_vat != null ? r.total_with_vat : "-"}</TableCell>
                      <TableCell><Badge variant="outline">{r.currency || "-"}</Badge></TableCell>
                      <TableCell>{r.confidence_score != null ? r.confidence_score : "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>פרטי חשבונית</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>ספק</Label>
                  <Select value={selected.supplier || ""} onValueChange={(v) => setSelected({ ...selected, supplier: v })}>
                    <SelectTrigger><SelectValue placeholder="בחר ספק" /></SelectTrigger>
                    <SelectContent>
                      {Object.values(suppliers).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>סוג מסמך</Label>
                  <Select value={selected.doc_type || ""} onValueChange={(v) => setSelected({ ...selected, doc_type: v })}>
                    <SelectTrigger><SelectValue placeholder="בחר סוג" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="חשבונית מס">חשבונית מס</SelectItem>
                      <SelectItem value="חשבונית זיכוי">חשבונית זיכוי</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>מספר מסמך</Label>
                  <Input value={selected.doc_number || ""} onChange={(e) => setSelected({ ...selected, doc_number: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>תאריך מסמך</Label>
                  <Input type="date" value={selected.doc_date || ""} onChange={(e) => setSelected({ ...selected, doc_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>מטבע</Label>
                  <Select value={selected.currency || "ILS"} onValueChange={(v) => setSelected({ ...selected, currency: v })}>
                    <SelectTrigger><SelectValue placeholder="בחר מטבע" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ILS">ILS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>סה״כ לפני מע"מ</Label>
                  <Input type="number" value={selected.subtotal_before_vat ?? ""} onChange={(e) => setSelected({ ...selected, subtotal_before_vat: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>מע"מ</Label>
                  <Input type="number" value={selected.vat_amount ?? ""} onChange={(e) => setSelected({ ...selected, vat_amount: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>סה״כ כולל מע"מ</Label>
                  <Input type="number" value={selected.total_with_vat ?? ""} onChange={(e) => setSelected({ ...selected, total_with_vat: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>מסמך מקור (ID)</Label>
                  <Input value={selected.source_intake || ""} onChange={(e) => setSelected({ ...selected, source_intake: e.target.value })} />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label>הערות</Label>
                  <Input value={selected.notes || ""} onChange={(e) => setSelected({ ...selected, notes: e.target.value })} />
                </div>
              </div>

              {!canApprove && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm">
                  פעולה של "אשר חשבונית"/"דחה" זמינה רק למנהלים, ותיושם אוטומטית בכפתורים אלו.
                </div>
              )}

              <div className="flex items-center gap-2 justify-between">
                <div className="flex gap-2">
                  {canApprove && (
                    <>
                      <Button onClick={async () => {
                        await base44.functions.invoke('updateInvoiceStatus', { invoice_id: selected.id, action: 'approve' });
                        setSelected(null);
                        load();
                      }} variant="secondary">אשר חשבונית</Button>
                      <Button onClick={async () => {
                        await base44.functions.invoke('updateInvoiceStatus', { invoice_id: selected.id, action: 'reject' });
                        setSelected(null);
                        load();
                      }} variant="destructive">דחה</Button>
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelected(null)}>סגור</Button>
                  <Button onClick={saveRecord} disabled={saving}>{saving ? "שומר..." : "שמור"}</Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}