import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCcw, FileText, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useUser } from "../components/UserAuth";

const statuses = ["הכל", "חדש", "מוכן לניתוח", "כפילות", "דולג", "עובד"];

export default function IntakeInbox() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("הכל");
  const [selected, setSelected] = useState(null);
  const { currentUser } = useUser();
  const canEdit = currentUser?.role === 'מנהל' || currentUser?.role === 'admin' || currentUser?.role === 'מנהל משמרת';

  const load = async () => {
    setLoading(true);
    try {
      const query = statusFilter !== "הכל" ? { status: statusFilter } : {};
      const list = await base44.entities.InvoiceIntakeRaw.filter(query, "-received_at", 200);
      setItems(list || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const grouped = useMemo(() => items, [items]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">תיבת קליטה</h1>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4"/>רענן</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Button key={s} variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
            {s}
          </Button>
        ))}
      </div>

      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle>רשימת מסמכים</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>תאריך קליטה</TableHead>
                  <TableHead>מקור</TableHead>
                  <TableHead>שולח</TableHead>
                  <TableHead>נושא</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead className="text-left">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6}>טוען...</TableCell></TableRow>
                ) : grouped.length === 0 ? (
                  <TableRow><TableCell colSpan={6}>אין תוצאות</TableCell></TableRow>
                ) : (
                  grouped.map((row) => (
                    <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                      <TableCell>{row.received_at ? new Date(row.received_at).toLocaleString() : "-"}</TableCell>
                      <TableCell>{row.source || "-"}</TableCell>
                      <TableCell>{row.gmail_from || "-"}</TableCell>
                      <TableCell>{row.gmail_subject || row.file_name || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.status || "-"}</Badge>
                      </TableCell>
                      <TableCell className="text-left">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(row); }} className="gap-1">
                          <Eye className="w-4 h-4"/> פתח
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

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>פרטי מסמך</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">{selected.file_name || ""}</div>
                {selected.file && (
                  <a href={selected.file} target="_blank" rel="noreferrer" className="text-indigo-600 flex items-center gap-1">
                    <FileText className="w-4 h-4"/> פתח בחלון חדש
                  </a>
                )}
              </div>

              <div className="h-[60vh] bg-gray-50 rounded border overflow-auto flex items-start justify-center p-3">
                {selected.file ? (
                  (() => {
                    const lower = String(selected.file).toLowerCase();
                    const isPdf = lower.includes('.pdf') || lower.includes('application/pdf');
                    if (isPdf) {
                      return (
                        <iframe
                          src={selected.file + '#toolbar=1&navpanes=0'}
                          title="Invoice preview"
                          className="w-full h-full bg-white rounded"
                        />
                      );
                    }
                    return (
                      <img
                        src={selected.file}
                        alt="Invoice preview"
                        className="object-contain max-w-none"
                        style={{ width: '100%', height: 'auto' }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    );
                  })()
                ) : (
                  <div className="text-gray-400 flex flex-col items-center justify-center h-full w-full">
                    אין קובץ להצגה
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {!canEdit && (<>
                  <div><span className="font-semibold">סטטוס:</span> {selected.status || "-"}</div>
                  <div><span className="font-semibold">סיבת סטטוס:</span> {selected.status_reason || "-"}</div>
                </>)}
                {canEdit && (
                  <>
                    <div className="space-y-1">
                      <Label>סטטוס</Label>
                      <Select value={selected.status || ''} onValueChange={(v) => setSelected({ ...selected, status: v })}>
                        <SelectTrigger><SelectValue placeholder="בחר סטטוס" /></SelectTrigger>
                        <SelectContent>
                          {['חדש','מוכן לניתוח','כפילות','דולג','עובד'].map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>סיבת סטטוס</Label>
                      <Textarea value={selected.status_reason || ''} onChange={(e) => setSelected({ ...selected, status_reason: e.target.value })} rows={3} />
                    </div>
                    <div className="space-y-1">
                      <Label>חשבונית מקושרת (ID)</Label>
                      <Input value={selected.linked_invoice || ''} onChange={(e) => setSelected({ ...selected, linked_invoice: e.target.value })} />
                    </div>
                  </>
                )}
                <div><span className="font-semibold">Gmail From:</span> {selected.gmail_from || "-"}</div>
                <div><span className="font-semibold">Gmail Subject:</span> {selected.gmail_subject || "-"}</div>
                <div><span className="font-semibold">Message ID:</span> {selected.gmail_message_id || "-"}</div>
                <div><span className="font-semibold">חשבונית מקושרת:</span> {selected.linked_invoice || "-"}</div>
              </div>

              {canEdit && (
                <div className="flex justify-between gap-2 pt-2">
                  <Button variant="destructive" onClick={async () => {
                    if (!confirm("האם למחוק את המסמך הזה? פעולה זו לא ניתנת לביטול.")) return;
                    try {
                      // Delete linked invoice if exists
                      if (selected.linked_invoice) {
                        try { await base44.entities.Invoices.delete(selected.linked_invoice); } catch (_) {}
                      }
                      await base44.entities.InvoiceIntakeRaw.delete(selected.id);
                      toast.success("המסמך נמחק בהצלחה");
                      setSelected(null);
                      load();
                    } catch (e) {
                      toast.error("שגיאה במחיקה");
                    }
                  }} className="gap-1">
                    <Trash2 className="w-4 h-4" />
                    מחק
                  </Button>
                  <div className="flex gap-2">
                    <Button onClick={async () => {
                      await base44.entities.InvoiceIntakeRaw.update(selected.id, {
                        status: selected.status,
                        status_reason: selected.status_reason || undefined,
                        linked_invoice: selected.linked_invoice || undefined
                      });
                      try { await base44.functions.invoke('processIntake', { intake_id: selected.id }); } catch (_) {}
                      setSelected(null);
                      load();
                    }}>שמור</Button>
                    {selected.linked_invoice && (
                      <Button variant="secondary" onClick={async () => {
                        try {
                          await base44.functions.invoke('runInvoiceExtractionByInvoice', { invoice_id: selected.linked_invoice });
                        } catch (_) {}
                        setSelected(null);
                        load();
                      }}>הרץ חילוץ AI</Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}