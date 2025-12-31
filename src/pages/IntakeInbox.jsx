import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCcw, FileText, Eye } from "lucide-react";

const statuses = ["הכל", "חדש", "מוכן לניתוח", "כפילות", "דולג", "עובד"];

export default function IntakeInbox() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("הכל");
  const [selected, setSelected] = useState(null);

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
                    <FileText className="w-4 h-4"/> צפייה/הורדה
                  </a>
                )}
              </div>

              {selected.file && selected.file_mime?.includes("pdf") && (
                <iframe title="preview" src={selected.file} className="w-full h-72 rounded-md border" />
              )}
              {selected.file && selected.file_mime?.startsWith?.("image") && (
                <img src={selected.file} alt="preview" className="max-h-72 rounded-md border" />
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div><span className="font-semibold">סטטוס:</span> {selected.status || "-"}</div>
                <div><span className="font-semibold">סיבת סטטוס:</span> {selected.status_reason || "-"}</div>
                <div><span className="font-semibold">Gmail From:</span> {selected.gmail_from || "-"}</div>
                <div><span className="font-semibold">Gmail Subject:</span> {selected.gmail_subject || "-"}</div>
                <div><span className="font-semibold">Message ID:</span> {selected.gmail_message_id || "-"}</div>
                <div><span className="font-semibold">חשבונית מקושרת:</span> {selected.linked_invoice || "-"}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}