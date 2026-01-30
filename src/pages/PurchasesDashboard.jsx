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
import useSuppliers from "../components/hooks/useSuppliers";


function FileActions({ invoiceId, sourceIntake }) {
  const [fileUrl, setFileUrl] = useState(null);
  const [loading, setLoading] = useState(false);

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
    <div className="flex items-center gap-1">
      <a
        href={fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 hover:bg-blue-100 rounded text-blue-600"
        title="פתח בתצוגה"
      >
        <Eye className="w-4 h-4" />
      </a>
    </div>
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

  const load = async () => {
    setLoading(true);
    try {
      // Load ALL invoices, not just approved
      const list = await base44.entities.Invoices.filter({}, '-doc_date', 1000);
      setRows(list || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);



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
  }, [rows, filterSupplier, filterStatus, dateRange, customFrom, customTo, searchText, sortOrder, suppliersMap]);

  const now = new Date();

  // Stats for approved invoices only (in selected date range)
  const approvedRows = rows.filter(r => r.extraction_status === 'אושר' && inDateRange(r));
  const purchases = approvedRows.filter(r => r.doc_type === 'חשבונית מס');
  const credits = approvedRows.filter(r => r.doc_type === 'חשבונית זיכוי');
  const sum = (arr) => arr.reduce((acc, r) => acc + (Number(r.total_with_vat) || 0), 0);
  const purchasesSum = sum(purchases);
  const creditsSum = sum(credits);

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="glass-card border-0">
          <CardHeader><CardTitle>סה״כ רכישות - {dateRangeLabel} (מאושרות)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-emerald-700">₪ {purchasesSum.toLocaleString()}</CardContent>
        </Card>
        <Card className="glass-card border-0">
          <CardHeader><CardTitle>סה״כ זיכויים - {dateRangeLabel} (מאושרים)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-rose-700">₪ {creditsSum.toLocaleString()}</CardContent>
        </Card>
      </div>

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
                  <th className="text-right py-2 px-2">סטטוס</th>
                  <th className="text-right py-2 px-2">קובץ</th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-4 text-gray-500">אין חשבוניות</td></tr>
                ) : recentInvoices.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-2">{suppliersMap[inv.supplier]?.name || inv.supplier || "-"}</td>
                    <td className="py-2 px-2">{inv.doc_type || "-"}</td>
                    <td className="py-2 px-2 font-mono">{inv.doc_number || "-"}</td>
                    <td className="py-2 px-2">{inv.doc_date || "-"}</td>
                    <td className="py-2 px-2 font-semibold">{inv.total_with_vat ? `₪${inv.total_with_vat.toLocaleString()}` : "-"}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}