import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, XCircle, Clock, RefreshCw, ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

const RECURRING_TYPE_COLORS = {
  'שכ"ד': "bg-blue-100 text-blue-800",
  'תקשורת': "bg-purple-100 text-purple-800",
  'מנוי': "bg-green-100 text-green-800",
  'שירות קבוע': "bg-orange-100 text-orange-800",
  'אחר': "bg-gray-100 text-gray-700",
};

function getMonthLabel(monthStr) {
  const [y, m] = monthStr.split("-");
  const months = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

  // Build table: one row per recurring supplier for selected month
  const rows = useMemo(() => {
    const checkMap = {};
    for (const c of checks) checkMap[c.supplier_id] = c;

    return recurringSuppliers.map(s => {
      const check = checkMap[s.id];
      return {
        supplier: s,
        check,
        status: check?.status || "חסר",
        matchedInvoice: check?.matched_invoice_number || null,
      };
    });
  }, [recurringSuppliers, checks]);

  const missingCount = rows.filter(r => r.status === "חסר").length;
  const receivedCount = rows.filter(r => r.status !== "חסר").length;

  // Sync: auto-match invoices for this month
  const syncMonth = async () => {
    setSyncing(true);
    try {
      // Get all invoices for this month (and next month to catch late arrivals)
      const nextMonth = shiftMonth(selectedMonth, 1);
      const [invoicesThisMonth, invoicesNextMonth] = await Promise.all([
        base44.entities.Invoices.filter({ }, null, 500),
        base44.entities.Invoices.filter({ }, null, 500),
      ]);
      
      // Filter by doc_date matching selectedMonth or nextMonth
      const allInvoices = [...invoicesThisMonth].filter(inv => {
        if (!inv.doc_date) return false;
        const invMonth = inv.doc_date.slice(0, 7);
        return invMonth === selectedMonth || invMonth === nextMonth;
      });

      let created = 0, matched = 0;
      for (const s of recurringSuppliers) {
        const existingCheck = checks.find(c => c.supplier_id === s.id);
        
        // Try to find a matching invoice by supplier name
        const supplierNames = [s.name, ...(s.aliases || "").split(",").map(a => a.trim())].filter(Boolean);
        const matchedInv = allInvoices.find(inv => 
          supplierNames.some(name => 
            inv.supplier?.includes(name) || name.includes(inv.supplier || "")
          )
        );

        if (existingCheck) {
          if (matchedInv && existingCheck.status === "חסר") {
            await base44.entities.RecurringExpenseCheck.update(existingCheck.id, {
              status: "התקבל",
              matched_invoice_id: matchedInv.id,
              matched_invoice_number: matchedInv.doc_number || "",
            });
            matched++;
          }
        } else {
          await base44.entities.RecurringExpenseCheck.create({
            supplier_id: s.id,
            supplier_name: s.name,
            recurring_type: s.recurring_type || "",
            month: selectedMonth,
            status: matchedInv ? "התקבל" : "חסר",
            matched_invoice_id: matchedInv?.id || "",
            matched_invoice_number: matchedInv?.doc_number || "",
          });
          created++;
          if (matchedInv) matched++;
        }
      }
      toast.success(`סנכרון הושלם: ${created} נוצרו, ${matched} הותאמו`);
      loadChecks();
    } catch (e) {
      toast.error("שגיאה בסנכרון: " + e.message);
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
          supplier_id: row.supplier.id,
          supplier_name: row.supplier.name,
          recurring_type: row.supplier.recurring_type || "",
          month: selectedMonth,
          status: "אושר ידנית",
        });
      }
      toast.success("סומן כאושר ידנית");
      loadChecks();
    } catch (e) {
      toast.error("שגיאה");
    }
  };

  const markMissing = async (row) => {
    try {
      if (row.check) {
        await base44.entities.RecurringExpenseCheck.update(row.check.id, { 
          status: "חסר", matched_invoice_id: "", matched_invoice_number: "" 
        });
      }
      toast.success("סומן כחסר");
      loadChecks();
    } catch (e) {
      toast.error("שגיאה");
    }
  };

  if (recurringSuppliers.length === 0) return null;

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
            <span className="font-semibold text-sm min-w-[120px] text-center">
              {getMonthLabel(selectedMonth)}
            </span>
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
          <Badge className="bg-green-100 text-green-800">{receivedCount} התקבלו</Badge>
          <Badge className="bg-red-100 text-red-800">{missingCount} חסרות</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ספק</TableHead>
                <TableHead>סוג</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>חשבונית</TableHead>
                <TableHead>פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-gray-500">טוען...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-gray-500">אין ספקים עם הוצאה קבועה</TableCell></TableRow>
              ) : (
                rows.map(row => (
                  <TableRow key={row.supplier.id} className={row.status === "חסר" ? "bg-red-50/50" : ""}>
                    <TableCell className="font-medium">{row.supplier.name}</TableCell>
                    <TableCell>
                      <Badge className={RECURRING_TYPE_COLORS[row.supplier.recurring_type] || "bg-gray-100 text-gray-700"}>
                        {row.supplier.recurring_type || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.status === "חסר" ? (
                        <Badge className="bg-red-100 text-red-800 gap-1">
                          <XCircle className="w-3 h-3" /> חסר
                        </Badge>
                      ) : row.status === "התקבל" ? (
                        <Badge className="bg-green-100 text-green-800 gap-1">
                          <CheckCircle className="w-3 h-3" /> התקבל
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-800 gap-1">
                          <CheckCircle className="w-3 h-3" /> אושר ידנית
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {row.matchedInvoice || "-"}
                    </TableCell>
                    <TableCell>
                      {row.status === "חסר" ? (
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => markManual(row)}>
                          אשר ידנית
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-xs h-7 text-red-600" onClick={() => markMissing(row)}>
                          סמן כחסר
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}