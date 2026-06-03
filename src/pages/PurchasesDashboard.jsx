import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3, RefreshCcw, FileText, CheckCircle, Clock, AlertTriangle, Calendar, Search, Eye, Download, X } from "lucide-react";
import { useUser } from "../components/UserAuth";
import { startOfMonth, endOfMonth, subWeeks, startOfWeek, endOfWeek, isAfter, isBefore, startOfDay, endOfDay, subDays, startOfYear, endOfYear, subMonths, subYears, format } from "date-fns";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import useSuppliers from "../components/hooks/useSuppliers";
import RecurringExpenseTable from "../components/recurring-expenses/RecurringExpenseTable";
import { getInvoiceClassification } from "../components/utils/invoiceClassification";


function FileActions({ invoiceId, sourceIntake }) {
  const [fileUrl, setFileUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadFile = async () => {
    if (fileUrl || !sourceIntake) return;
    setLoading(true);
    try {
      const intakes = await base44.entities.InvoiceIntakeRaw.filter({ id: sourceIntake });
      if (intakes?.[0]?.file) {
        setFileUrl(intakes[0].file);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sourceIntake) loadFile();
  }, [sourceIntake]);

  if (!sourceIntake) return <span className="text-gray-400 text-xs">-</span>;
  if (loading) return <span className="text-gray-400 text-xs">טוען...</span>;
  if (!fileUrl) return <span className="text-gray-400 text-xs">אין קובץ</span>;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1 hover:bg-blue-100 rounded text-blue-600"
        title="תצוגה מקדימה"
      >
        <Eye className="w-4 h-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] max-w-[1200px] h-[85vh] md:h-[80vh]" dir="rtl">
          <DialogHeader>
            <DialogTitle>תצוגה מקדימה</DialogTitle>
          </DialogHeader>
          <div className="w-full h-[calc(80vh-60px)]">
            {fileUrl ? (
              (() => {
                const lower = String(fileUrl).toLowerCase();
                const isPdf = lower.includes('.pdf') || lower.includes('application/pdf');
                if (isPdf) {
                  return (
                    <iframe
                      src={fileUrl + '#toolbar=1&navpanes=0'}
                      title="Invoice preview"
                      className="w-full h-full bg-white rounded"
                    />
                  );
                }
                return (
                  <img
                    src={fileUrl}
                    alt="Invoice preview"
                    className="object-contain max-w-none w-full h-full bg-white"
                  />
                );
              })()
            ) : (
              <div className="text-gray-400 flex items-center justify-center w-full h-full">
                אין קובץ להצגה
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PurchasesDashboard() {
  const { currentUser } = useUser();
  const forbidden = currentUser?.role === 'נציג' || currentUser?.role === 'מנהל משמרת';

  const [rows, setRows] = useState([]);
  const { suppliersMap, suppliersList } = useSuppliers();
  const [loading, setLoading] = useState(true);
  const [filterSupplier, setFilterSupplier] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [dateRange, setDateRange] = useState("month"); // today, yesterday, week, month, lastMonth, year, lastYear, custom
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sortOrder, setSortOrder] = useState("desc"); // desc = newest first, asc = oldest first
  const [filterClassification, setFilterClassification] = useState(() => new URLSearchParams(window.location.search).get('classification') || 'all');
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [editForm, setEditForm] = useState({ classification: 'goods', expense_category: '' });
  // Preview state for row click
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      // Load ALL invoices, not just approved
      const list = await base44.entities.Invoices.filter({}, '-doc_date', 1000);
      setRows(list || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Open preview for a specific invoice row
  const openPreview = async (inv) => {
    if (!inv?.source_intake) return;
    const intakes = await base44.entities.InvoiceIntakeRaw.filter({ id: inv.source_intake });
    const url = intakes?.[0]?.file;
    if (url) {
      setPreviewUrl(url);
      setPreviewOpen(true);
    }
  };

  const openEdit = (invoice) => {
    const classification = getInvoiceClassification(invoice, suppliersMap);
    setEditingInvoice(invoice);
    setEditForm({
      classification: classification.type,
      expense_category: invoice.expense_category || classification.category || '',
    });
  };

  const saveManualClassification = async () => {
    if (!editingInvoice) return;
    const data = {
      classification_status: 'manually_corrected',
      classification_confidence: 100,
      expense_category: editForm.expense_category,
      is_goods_invoice: editForm.classification === 'goods',
      is_recurring_expense: editForm.classification === 'recurring',
      notes: `${editingInvoice.notes || ''}\n[manual_classification_override] סיווג ידני: ${editForm.classification}`.trim(),
    };
    await base44.entities.Invoices.update(editingInvoice.id, data);
    setRows(prev => prev.map(row => row.id === editingInvoice.id ? { ...row, ...data } : row));
    setEditingInvoice(null);
  };



  // Calculate date range
  const getDateRangeBounds = () => {
    const now = new Date();
    switch (dateRange) {
      case "today":
        return { start: startOfDay(now), end: endOfDay(now) };
      case "yesterday":
        return { start: startOfDay(subDays(now, 1)), end: endOfDay(subDays(now, 1)) };
      case "week":
        return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
      case "month":
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case "lastMonth":
        return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
      case "year":
        return { start: startOfYear(now), end: endOfYear(now) };
      case "lastYear":
        return { start: startOfYear(subYears(now, 1)), end: endOfYear(subYears(now, 1)) };
      case "custom":
        return {
          start: customFrom ? startOfDay(new Date(customFrom)) : new Date(0),
          end: customTo ? endOfDay(new Date(customTo)) : now
        };
      default:
        return { start: startOfMonth(now), end: endOfMonth(now) };
    }
  };

  const { start: rangeStart, end: rangeEnd } = getDateRangeBounds();

  const inDateRange = (r) => {
    if (!r.doc_date) return false;
    const d = new Date(r.doc_date);
    return !isBefore(d, rangeStart) && !isAfter(d, rangeEnd);
  };

  // Filter rows
  const filteredRows = useMemo(() => {
    let result = rows.filter(r => {
      if (filterSupplier !== "all" && r.supplier !== filterSupplier) return false;
      if (filterStatus !== "all" && r.extraction_status !== filterStatus) return false;
      if (filterClassification !== "all" && getInvoiceClassification(r, suppliersMap).type !== filterClassification) return false;
      if (!inDateRange(r)) return false;
      // Search by doc_number
      if (searchText.trim()) {
        const search = searchText.trim().toLowerCase();
        const docNum = (r.doc_number || '').toLowerCase();
        const supplierName = (suppliersMap[r.supplier]?.name || '').toLowerCase();
        if (!docNum.includes(search) && !supplierName.includes(search)) return false;
      }
      return true;
    });
    // Sort by date
    result.sort((a, b) => {
      const dateA = a.doc_date ? new Date(a.doc_date).getTime() : 0;
      const dateB = b.doc_date ? new Date(b.doc_date).getTime() : 0;
      return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });
    return result;
  }, [rows, filterSupplier, filterStatus, filterClassification, dateRange, customFrom, customTo, searchText, sortOrder, suppliersMap]);

  const now = new Date();

  // Stats for approved invoices only (in selected date range)
  const approvedRows = rows.filter(r => r.extraction_status === 'אושר' && inDateRange(r));
  const purchases = approvedRows.filter(r => r.doc_type === 'חשבונית מס');
  const credits = approvedRows.filter(r => r.doc_type === 'חשבונית זיכוי');
  const sum = (arr) => arr.reduce((acc, r) => acc + (Number(r.total_with_vat) || 0), 0);
  const purchasesSum = sum(purchases);
  const creditsSum = sum(credits);
  const isGoodsPurchase = (invoice) => getInvoiceClassification(invoice, suppliersMap).type === 'goods';
  const isRecurringPurchase = (invoice) => getInvoiceClassification(invoice, suppliersMap).type === 'recurring';
  const goodsPurchasesSum = sum(purchases.filter(isGoodsPurchase));
  const recurringExpensesSum = sum(purchases.filter(isRecurringPurchase));
  const otherExpensesSum = purchasesSum - goodsPurchasesSum - recurringExpensesSum;
  const recurringSuppliers = useMemo(() => suppliersList.filter(s =>
    s.is_recurring_expense === true ||
    s.is_recurring === true ||
    (s.recurring_frequency && s.recurring_frequency !== 'none')
  ), [suppliersList]);

  // Status counts (in selected date range)
  const statusCounts = useMemo(() => {
    const counts = { pending: 0, approved: 0, rejected: 0, read: 0 };
    rows.filter(r => inDateRange(r)).forEach(r => {
      if (r.extraction_status === 'ממתין לאימות') counts.pending++;
      else if (r.extraction_status === 'אושר') counts.approved++;
      else if (r.extraction_status === 'נדחה') counts.rejected++;
      else if (r.extraction_status === 'נקרא בהצלחה') counts.read++;
    });
    return counts;
  }, [rows, dateRange, customFrom, customTo]);

  const dateRangeLabel = {
    today: "היום",
    yesterday: "אתמול",
    week: "השבוע",
    month: "החודש",
    lastMonth: "חודש שעבר",
    year: "השנה",
    lastYear: "שנה שעברה",
    custom: "טווח מותאם"
  }[dateRange];

  // All suppliers sorted by total (from approved invoices)
  const allSuppliersSorted = useMemo(() => {
    const agg = {};
    for (const r of purchases) {
      const key = r.supplier || 'unknown';
      agg[key] = (agg[key] || 0) + (Number(r.total_with_vat) || 0);
    }
    const items = Object.entries(agg).map(([id, total]) => ({ id, name: suppliersMap[id]?.name || id, total }));
    items.sort((a,b) => b.total - a.total);
    return items;
  }, [purchases, suppliersMap]);

  // Recent invoices table (filtered)
  const recentInvoices = useMemo(() => {
    return filteredRows.slice(0, 20);
  }, [filteredRows]);

  // Weekly trend - last 8 weeks
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = endOfWeek(subWeeks(now, i), { weekStartsOn: 0 });
    const start = startOfWeek(end, { weekStartsOn: 0 });
    return { start, end };
  }).reverse();

  const weeklyData = weeks.map((w) => {
    const sumW = rows.filter(r => r.doc_type === 'חשבונית מס' && r.doc_date && !isBefore(new Date(r.doc_date), w.start) && !isAfter(new Date(r.doc_date), w.end))
      .reduce((acc, r) => acc + (Number(r.total_with_vat) || 0), 0);
    const label = `${w.start.getDate()}/${w.start.getMonth()+1}`;
    return { name: label, total: sumW };
  });

  if (forbidden) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
        <p className="text-gray-600 mt-2">דף זה זמין למנהלים בלבד</p>
      {/* Preview Dialog for row click */}
      <Dialog open={previewOpen} onOpenChange={(o) => { if (!o) { setPreviewOpen(false); setPreviewUrl(null); } }}>
        <DialogContent className="w-[95vw] max-w-[1200px] h-[85vh] md:h-[80vh]" dir="rtl">
          <DialogHeader>
            <DialogTitle>תצוגה מקדימה</DialogTitle>
          </DialogHeader>
          <div className="w-full h-[calc(80vh-60px)]">
            {previewUrl ? (
              (() => {
                const lower = String(previewUrl).toLowerCase();
                const isPdf = lower.includes('.pdf') || lower.includes('application/pdf');
                if (isPdf) {
                  return (
                    <iframe src={previewUrl + '#toolbar=1&navpanes=0'} title="Invoice preview" className="w-full h-full bg-white rounded" />
                  );
                }
                return (
                  <img src={previewUrl} alt="Invoice preview" className="object-contain max-w-none w-full h-full bg-white" />
                );
              })()
            ) : (
              <div className="text-gray-400 flex items-center justify-center w-full h-full">אין קובץ להצגה</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      </div>
      );
      }

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-600">טוען דשבורד רכישות...</div>
    );
  }

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6"/> דשבורד רכישות</h1>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4"/>רענן</Button>
      </div>

      {/* Date Range Filter */}
      <Card className="glass-card border-0 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600" />
            <span className="font-medium">סינון תאריך:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "today", label: "היום" },
              { value: "yesterday", label: "אתמול" },
              { value: "week", label: "השבוע" },
              { value: "month", label: "החודש" },
              { value: "lastMonth", label: "חודש שעבר" },
              { value: "year", label: "השנה" },
              { value: "lastYear", label: "שנה שעברה" },
              { value: "custom", label: "מותאם" }
            ].map(opt => (
              <Button
                key={opt.value}
                variant={dateRange === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          {dateRange === "custom" && (
            <div className="flex items-center gap-2 mt-2 md:mt-0">
              <div className="flex items-center gap-1">
                <Label className="text-sm">מ:</Label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="w-36"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label className="text-sm">עד:</Label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="w-36"
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="glass-card border-0 p-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-500" />
            <div>
              <div className="text-xs text-gray-600">ממתינות לאימות</div>
              <div className="text-xl font-bold text-orange-600">{statusCounts.pending}</div>
            </div>
          </div>
        </Card>
        <Card className="glass-card border-0 p-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            <div>
              <div className="text-xs text-gray-600">נקראו בהצלחה</div>
              <div className="text-xl font-bold text-blue-600">{statusCounts.read}</div>
            </div>
          </div>
        </Card>
        <Card className="glass-card border-0 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <div>
              <div className="text-xs text-gray-600">אושרו</div>
              <div className="text-xl font-bold text-green-600">{statusCounts.approved}</div>
            </div>
          </div>
        </Card>
        <Card className="glass-card border-0 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <div>
              <div className="text-xs text-gray-600">נדחו</div>
              <div className="text-xl font-bold text-red-600">{statusCounts.rejected}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card border-0">
          <CardHeader><CardTitle>סה״כ הוצאות - {dateRangeLabel}</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-emerald-700">₪ {purchasesSum.toLocaleString()}</CardContent>
        </Card>
        <Card className="glass-card border-0 cursor-pointer hover:ring-2 hover:ring-blue-200" onClick={() => { setFilterClassification('goods'); document.getElementById('invoices-table')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <CardHeader><CardTitle>קניית סחורה</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-blue-700">₪ {goodsPurchasesSum.toLocaleString()}</CardContent>
        </Card>
        <Card className="glass-card border-0 cursor-pointer hover:ring-2 hover:ring-amber-200" onClick={() => { setFilterClassification('recurring'); document.getElementById('invoices-table')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <CardHeader><CardTitle>הוצאות קבועות</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-amber-700">₪ {recurringExpensesSum.toLocaleString()}</CardContent>
        </Card>
        <Card className="glass-card border-0">
          <CardHeader><CardTitle>זיכויים / אחרות</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <div className="text-xl font-bold text-rose-700">זיכויים: ₪ {creditsSum.toLocaleString()}</div>
            <div className="text-sm font-semibold text-gray-600">אחרות: ₪ {otherExpensesSum.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      <RecurringExpenseTable recurringSuppliers={recurringSuppliers} />

      <Card className="glass-card border-0">
        <CardHeader><CardTitle>כל הספקים - {dateRangeLabel} (לפי סכום יורד)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {allSuppliersSorted.length === 0 ? (
              <div className="text-gray-500">אין נתונים</div>
            ) : allSuppliersSorted.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between border-b py-2 hover:bg-gray-50 rounded px-2">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs w-6">{i+1}.</span>
                  <button
                    onClick={() => {
                      setFilterSupplier(s.id);
                      document.getElementById('invoices-table')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline text-right"
                  >
                    {s.name}
                  </button>
                </div>
                <div className="font-semibold">₪ {s.total.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-0">
        <CardHeader><CardTitle>מגמת רכישות שבועית (8 שבועות אחרונים)</CardTitle></CardHeader>
        <CardContent style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Recent invoices table with filters */}
      <Card id="invoices-table" className="glass-card border-0">
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CardTitle>חשבוניות ({filteredRows.length})</CardTitle>
                {filterSupplier !== "all" && (
                  <Badge className="bg-indigo-100 text-indigo-800 flex items-center gap-1">
                    {suppliersMap[filterSupplier]?.name}
                    <button onClick={() => setFilterSupplier("all")} className="hover:text-indigo-600">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="חיפוש מספר חשבונית..."
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    className="pr-8 w-[180px]"
                  />
                </div>
                <Select value={sortOrder} onValueChange={setSortOrder}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="מיון" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">חדש לישן</SelectItem>
                    <SelectItem value="asc">ישן לחדש</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterSupplier} onValueChange={setFilterSupplier}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="כל הספקים" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הספקים</SelectItem>
                    {suppliersList.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterClassification} onValueChange={setFilterClassification}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="כל הסיווגים" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הסיווגים</SelectItem>
                    <SelectItem value="goods">סחורה</SelectItem>
                    <SelectItem value="recurring">הוצאות קבועות</SelectItem>
                    <SelectItem value="other">הוצאות אחרות</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="כל הסטטוסים" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הסטטוסים</SelectItem>
                    <SelectItem value="ממתין לאימות">ממתין לאימות</SelectItem>
                    <SelectItem value="נקרא בהצלחה">נקרא בהצלחה</SelectItem>
                    <SelectItem value="אושר">אושר</SelectItem>
                    <SelectItem value="נדחה">נדחה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-right py-2 px-2">ספק</th>
                  <th className="text-right py-2 px-2">סוג</th>
                  <th className="text-right py-2 px-2">מספר</th>
                  <th className="text-right py-2 px-2">תאריך</th>
                  <th className="text-right py-2 px-2">סכום</th>
                  <th className="text-right py-2 px-2">סיווג</th>
                  <th className="text-right py-2 px-2">סטטוס</th>
                  <th className="text-right py-2 px-2">קובץ</th>
                  <th className="text-right py-2 px-2">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-4 text-gray-500">אין חשבוניות</td></tr>
                ) : recentInvoices.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => openPreview(inv)}>
                    <td className="py-2 px-2">{suppliersMap[inv.supplier]?.name || inv.supplier || "-"}</td>
                    <td className="py-2 px-2">{inv.doc_type || "-"}</td>
                    <td className="py-2 px-2 font-mono">{inv.doc_number || "-"}</td>
                    <td className="py-2 px-2">{inv.doc_date || "-"}</td>
                    <td className="py-2 px-2 font-semibold">{inv.total_with_vat ? `₪${inv.total_with_vat.toLocaleString()}` : "-"}</td>
                    <td className="py-2 px-2">
                      {(() => {
                        const classification = getInvoiceClassification(inv, suppliersMap);
                        const cls = classification.type === 'goods' ? 'bg-blue-100 text-blue-800' : classification.type === 'recurring' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700';
                        return <Badge className={cls}>{classification.label}</Badge>;
                      })()}
                    </td>
                    <td className="py-2 px-2">
                      <Badge variant="outline" className={
                        inv.extraction_status === 'אושר' ? 'bg-green-100 text-green-800' :
                        inv.extraction_status === 'נדחה' ? 'bg-red-100 text-red-800' :
                        inv.extraction_status === 'נקרא בהצלחה' ? 'bg-blue-100 text-blue-800' :
                        'bg-orange-100 text-orange-800'
                      }>
                        {inv.extraction_status || "לא ידוע"}
                      </Badge>
                    </td>
                    <td className="py-2 px-2">
                      <FileActions invoiceId={inv.id} sourceIntake={inv.source_intake} />
                    </td>
                    <td className="py-2 px-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(inv); }}>
                        ערוך סיווג
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editingInvoice} onOpenChange={(open) => !open && setEditingInvoice(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>עריכת סיווג חשבונית</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              {editingInvoice && `${suppliersMap[editingInvoice.supplier]?.name || editingInvoice.supplier || '-'} · ${editingInvoice.doc_number || '-'}`}
            </div>
            <div className="space-y-2">
              <Label>סיווג</Label>
              <Select value={editForm.classification} onValueChange={(value) => setEditForm(prev => ({ ...prev, classification: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="goods">סחורה</SelectItem>
                  <SelectItem value="recurring">הוצאה קבועה</SelectItem>
                  <SelectItem value="other">הוצאה אחרת</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>קטגוריה</Label>
              <Input value={editForm.expense_category} onChange={(e) => setEditForm(prev => ({ ...prev, expense_category: e.target.value }))} placeholder="לדוגמה: סחורה - טלפונים / שירותי תקשורת" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingInvoice(null)}>ביטול</Button>
              <Button onClick={saveManualClassification}>שמור</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}