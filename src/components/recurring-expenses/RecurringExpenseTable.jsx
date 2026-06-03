import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw, ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

const TYPE_COLORS = {
  'שכ"ד': "bg-blue-100 text-blue-800",
  'תקשורת': "bg-purple-100 text-purple-800",
  'מנוי': "bg-green-100 text-green-800",
  'שירות קבוע': "bg-orange-100 text-orange-800",
  'אחר': "bg-gray-100 text-gray-700",
};

function getMonthLabel(m) {
  const [y, mo] = m.split("-");
  const names = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  return `${names[parseInt(mo) - 1]} ${y}`;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseMatchedInvoices(json) {
  try { return JSON.parse(json || "[]"); } catch { return []; }
}

export default function RecurringExpenseTable({ recurringSuppliers }) {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [syncing, setSyncing] = useState(false);

  const loadChecks = async () => {
    setLoading(true);
    try {
      const all = await base44.entities.RecurringExpenseCheck.filter({ month: selectedMonth }, null, 200);
      setChecks(all);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadChecks(); }, [selectedMonth]);

  const rows = useMemo(() => {
    const checkMap = {};
    for (const c of checks) checkMap[c.supplier_id] = c;
    return recurringSuppliers.map(s => {
      const check = checkMap[s.id];
      const expected = s.expected_invoices_per_month || 1;
      const received = check?.received_count || 0;
      const matched = parseMatchedInvoices(check?.matched_invoices_json);
      return { supplier: s, check, expected, received, matched, status: check?.status || "חסר" };
    });
  }, [recurringSuppliers, checks]);

  const missingCount = rows.filter(r => r.status === "חסר" || r.status === "חלקי").length;
  const okCount = rows.filter(r => r.status === "התקבל" || r.status === "אושר ידנית").length;

  const syncMonth = async () => {
    setSyncing(true);
    try {
      const nextMonth = shiftMonth(selectedMonth, 1);
      const allInvoices = await base44.entities.Invoices.filter({}, null, 1000);
      const relevant = allInvoices.filter(inv => {
        if (!inv.doc_date) return false;
        const m = inv.doc_date.slice(0, 7);
        return m === selectedMonth || m === nextMonth;
      });

      let updated = 0;
      for (const s of recurringSuppliers) {
        const existing = checks.find(c => c.supplier_id === s.id);
        const expected = s.expected_invoices_per_month || 1;

        // Find ALL matching invoices by supplier id / detected supplier id
        const matched = relevant.filter(inv => inv.supplier === s.id || inv.detected_supplier_id === s.id);
        const receivedCount = matched.length;
        const status = receivedCount >= expected ? "התקבל" : receivedCount > 0 ? "חלקי" : "חסר";
        const matchedJson = JSON.stringify(matched.map(inv => ({ id: inv.id, doc_number: inv.doc_number || "", supplier: inv.supplier || "" })));

        if (existing) {
          if (existing.status !== "אושר ידנית") {
            await base44.entities.RecurringExpenseCheck.update(existing.id, {
              received_count: receivedCount, status, matched_invoices_json: matchedJson, expected_count: expected,
            });
            updated++;
          }
        } else {
          await base44.entities.RecurringExpenseCheck.create({
            supplier_id: s.id, supplier_name: s.name, recurring_type: s.recurring_type || s.supplier_type || "",
            month: selectedMonth, expected_count: expected, received_count: receivedCount,
            status, matched_invoices_json: matchedJson,
          });
          updated++;
        }
      }
      toast.success(`סנכרון הושלם: ${updated} עודכנו`);
      loadChecks();
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const markManual = async (row) => {
    try {
      if (row.check) {
        await base44.entities.RecurringExpenseCheck.update(row.check.id, { status: "אושר ידנית" });
      } else {
        await base44.entities.RecurringExpenseCheck.create({
          supplier_id: row.supplier.id, supplier_name: row.supplier.name,
          recurring_type: row.supplier.recurring_type || row.supplier.supplier_type || "", month: selectedMonth,
          expected_count: row.expected, received_count: 0, status: "אושר ידנית",
        });
      }
      toast.success("אושר ידנית"); loadChecks();
    } catch { toast.error("שגיאה"); }
  };

  const markMissing = async (row) => {
    try {
      if (row.check) {
        await base44.entities.RecurringExpenseCheck.update(row.check.id, { status: "חסר", received_count: 0, matched_invoices_json: "[]" });
      }
      toast.success("סומן כחסר"); loadChecks();
    } catch { toast.error("שגיאה"); }
  };

  if (recurringSuppliers.length === 0) return null;

  const StatusBadge = ({ status, received, expected }) => {
    if (status === "התקבל") return <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle className="w-3 h-3" />{received}/{expected}</Badge>;
    if (status === "חלקי") return <Badge className="bg-amber-100 text-amber-800 gap-1"><AlertTriangle className="w-3 h-3" />{received}/{expected}</Badge>;
    if (status === "אושר ידנית") return <Badge className="bg-blue-100 text-blue-800 gap-1"><CheckCircle className="w-3 h-3" />אושר ידנית</Badge>;
    return <Badge className="bg-red-100 text-red-800 gap-1"><XCircle className="w-3 h-3" />{received}/{expected} חסר</Badge>;
  };

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            מעקב הוצאות קבועות
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="font-semibold text-sm min-w-[120px] text-center">{getMonthLabel(selectedMonth)}</span>
            <Button variant="ghost" size="icon" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={syncMonth} disabled={syncing} className="gap-1.5 mr-2">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              סנכרן חשבוניות
            </Button>
          </div>
        </div>
        <div className="flex gap-3 mt-2">
          <Badge className="bg-green-100 text-green-800">{okCount} תקין</Badge>
          <Badge className="bg-red-100 text-red-800">{missingCount} חסר/חלקי</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ספק</TableHead>
                <TableHead>סוג</TableHead>
                <TableHead>צפוי</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>חשבוניות</TableHead>
                <TableHead>פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-gray-500">טוען...</TableCell></TableRow>
              ) : rows.map(row => (
                <TableRow key={row.supplier.id} className={row.status === "חסר" ? "bg-red-50/50" : row.status === "חלקי" ? "bg-amber-50/50" : ""}>
                  <TableCell className="font-medium">{row.supplier.name}</TableCell>
                  <TableCell>
                    <Badge className={TYPE_COLORS[row.supplier.recurring_type] || "bg-gray-100 text-gray-700"}>
                      {row.supplier.recurring_type || row.supplier.recurring_frequency || row.supplier.supplier_type || "-"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center font-mono">{row.expected}</TableCell>
                  <TableCell><StatusBadge status={row.status} received={row.received} expected={row.expected} /></TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {row.matched.length > 0 
                      ? row.matched.map((m, i) => <span key={i} className="inline-block bg-gray-100 rounded px-1.5 py-0.5 text-xs mr-1 mb-0.5">{m.doc_number}</span>)
                      : "-"
                    }
                  </TableCell>
                  <TableCell>
                    {(row.status === "חסר" || row.status === "חלקי") ? (
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => markManual(row)}>אשר ידנית</Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-xs h-7 text-red-600" onClick={() => markMissing(row)}>סמן כחסר</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}