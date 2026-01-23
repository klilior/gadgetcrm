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
import useSuppliers from "../components/hooks/useSuppliers";
import { RefreshCcw, AlertTriangle, FileText, Eye, ExternalLink, ZoomIn, ZoomOut } from "lucide-react";

export default function InvoicesToReview() {
  const [rows, setRows] = useState([]);
  const { suppliersMap, suppliersList } = useSuppliers();
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const { currentUser } = useUser();
  const canApprove = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      // Only load invoices that have actual data (not empty placeholders)
      const invoices = await base44.entities.Invoices.filter({ extraction_status: { "$in": ["ממתין לאימות", "נקרא בהצלחה"] } }, "-doc_date", 200);
      // Filter out completely empty records (no supplier, no doc_number, no total)
      const filtered = (invoices || []).filter(inv => 
        inv.supplier || inv.doc_number || inv.total_with_vat || inv.doc_date
      );
      setRows(filtered);
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
      
      // Learn supplier pattern if supplier was manually set
      if (selected.supplier && selected.ai_debug_last_extraction_json) {
        try {
          const extraction = JSON.parse(selected.ai_debug_last_extraction_json);
          const normalizedName = extraction.supplier_name_normalized?.trim();
          if (normalizedName) {
            // Check if pattern exists
            const existingPatterns = await base44.entities.SupplierPattern.filter({
              pattern_type: 'name_pattern',
              pattern_value: normalizedName
            });
            if (!existingPatterns || existingPatterns.length === 0) {
              await base44.entities.SupplierPattern.create({
                supplier_id: selected.supplier,
                pattern_type: 'name_pattern',
                pattern_value: normalizedName,
                confidence: 100,
                learned_from_invoice: selected.id,
                is_active: true
              });
              toast.info("המערכת למדה את הספק לזיהוי עתידי");
            }
          }
        } catch (_) {}
      }
      
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
        <div className="flex gap-2">
          {canApprove && (
            <Button 
              variant="outline" 
              onClick={async () => {
                try {
                  toast.info("מנקה מסמכים שאינם חשבוניות...");
                  await base44.functions.invoke('cleanupSkippedInvoices');
                  toast.success("הניקוי הושלם");
                  load();
                } catch (e) {
                  toast.error("שגיאה בניקוי: " + (e?.message || "שגיאה"));
                }
              }}
              className="gap-2"
            >
              🧹 נקה מסמכים שאינם חשבוניות
            </Button>
          )}
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4"/>רענן</Button>
        </div>
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
                  <TableHead>סטטוס ניתוח</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7}>טוען...</TableCell></TableRow>
                ) : sorted.length === 0 ? (
                  <TableRow><TableCell colSpan={7}>אין תוצאות</TableCell></TableRow>
                ) : (
                  sorted.map((r) => {
                    const hasData = r.supplier || r.doc_number || r.total_with_vat;
                    const confidence = r.confidence_score;
                    const needsReview = !hasData || confidence < 70;
                    
                    return (
                      <TableRow 
                        key={r.id} 
                        className={`cursor-pointer hover:bg-purple-50/50 ${needsReview ? 'bg-amber-50/50' : ''}`} 
                        onClick={() => openRecord(r)}
                      >
                        <TableCell className="font-medium">
                          {suppliersMap[r.supplier]?.name || r.supplier || 
                            <span className="text-gray-400 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                              חסר
                            </span>
                          }
                        </TableCell>
                        <TableCell>{r.doc_type || <span className="text-gray-400">-</span>}</TableCell>
                        <TableCell>{r.doc_number || <span className="text-gray-400">-</span>}</TableCell>
                        <TableCell>{r.doc_date || <span className="text-gray-400">-</span>}</TableCell>
                        <TableCell className="font-medium">
                          {r.total_with_vat != null ? `₪${r.total_with_vat.toLocaleString()}` : <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell><Badge variant="outline">{r.currency || "ILS"}</Badge></TableCell>
                        <TableCell>
                          {confidence != null ? (
                            <Badge variant={confidence >= 80 ? "default" : confidence >= 50 ? "secondary" : "destructive"}>
                              {confidence}%
                            </Badge>
                          ) : <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.extraction_status === 'נקרא בהצלחה' ? 'default' : 'outline'}>
                            {r.extraction_status || "-"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
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
                      {suppliersList.map((s) => (
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

              {/* Show source file link if available */}
              {selected.source_intake && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span>מסמך מקור: {selected.source_intake}</span>
                </div>
              )}

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
                  <Button variant="secondary" onClick={async () => {
                    try {
                      toast.info("מריץ חילוץ AI...");
                      await base44.functions.invoke('runInvoiceExtractionByInvoice', { invoice_id: selected.id });
                      toast.success("חילוץ הושלם");
                    } catch (e) {
                      toast.error("שגיאה בחילוץ: " + (e?.message || "שגיאה"));
                    }
                    setSelected(null);
                    load();
                  }}>🤖 הרץ AI</Button>
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