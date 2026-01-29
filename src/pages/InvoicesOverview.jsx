import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Filter, Search, X, ZoomIn, ZoomOut, FileText } from "lucide-react";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, subWeeks, subMonths, subYears, startOfDay, endOfDay, startOfYear, endOfYear, isBefore, isAfter } from "date-fns";
import useSuppliers from "../components/hooks/useSuppliers";

export default function InvoicesOverview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const { suppliersMap, suppliersList } = useSuppliers();

  // Filters
  const [dateRange, setDateRange] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDocType, setFilterDocType] = useState("all");
  const [searchText, setSearchText] = useState("");

  // Selection & preview
  const [selected, setSelected] = useState(null);
  const [intakeFile, setIntakeFile] = useState(null);
  const [imageZoom, setImageZoom] = useState(100);

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Invoices.filter({}, '-doc_date', 1000);
      setRows(list || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Supplier color map
  const supplierColors = useMemo(() => {
    const colors = [
      'bg-blue-50', 'bg-green-50', 'bg-purple-50', 'bg-orange-50', 'bg-pink-50',
      'bg-cyan-50', 'bg-amber-50', 'bg-indigo-50', 'bg-rose-50', 'bg-teal-50',
    ];
    const map = {};
    const ids = [...new Set(rows.map(r => r.supplier).filter(Boolean))];
    ids.forEach((id, idx) => { map[id] = colors[idx % colors.length]; });
    return map;
  }, [rows]);

  // Date range helpers
  const { start: rangeStart, end: rangeEnd } = useMemo(() => {
    const now = new Date();
    switch (dateRange) {
      case 'today': return { start: startOfDay(now), end: endOfDay(now) };
      case 'yesterday': return { start: startOfDay(new Date(now.getTime() - 86400000)), end: endOfDay(new Date(now.getTime() - 86400000)) };
      case 'week': return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
      case 'month': return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'lastMonth': return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) };
      case 'year': return { start: startOfYear(now), end: endOfYear(now) };
      case 'lastYear': return { start: startOfYear(subYears(now, 1)), end: endOfYear(subYears(now, 1)) };
      case 'custom':
        return {
          start: customFrom ? startOfDay(new Date(customFrom)) : new Date(0),
          end: customTo ? endOfDay(new Date(customTo)) : now
        };
      default: return { start: startOfMonth(now), end: endOfMonth(now) };
    }
  }, [dateRange, customFrom, customTo]);

  const inDateRange = (r) => {
    if (!r.doc_date) return false;
    const d = new Date(r.doc_date);
    return !isBefore(d, rangeStart) && !isAfter(d, rangeEnd);
  };

  // Filter & sort
  const filteredRows = useMemo(() => {
    const txt = searchText.trim().toLowerCase();
    let result = rows.filter(r => inDateRange(r));
    if (filterSupplier !== 'all') result = result.filter(r => r.supplier === filterSupplier);
    if (filterStatus !== 'all') result = result.filter(r => r.extraction_status === filterStatus);
    if (filterDocType !== 'all') result = result.filter(r => r.doc_type === filterDocType);
    if (txt) {
      result = result.filter(r => {
        const doc = (r.doc_number || '').toLowerCase();
        const sup = (suppliersMap[r.supplier]?.name || '').toLowerCase();
        return doc.includes(txt) || sup.includes(txt);
      });
    }
    // Sort by invoice date desc
    result.sort((a, b) => {
      const aT = a.doc_date ? new Date(a.doc_date).getTime() : 0;
      const bT = b.doc_date ? new Date(b.doc_date).getTime() : 0;
      return bT - aT;
    });
    return result;
  }, [rows, filterSupplier, filterStatus, filterDocType, searchText, suppliersMap, rangeStart, rangeEnd]);

  // Open details
  const openRow = async (row) => {
    setSelected(row);
    setIntakeFile(null);
    setImageZoom(100);
    if (row.source_intake) {
      try {
        const list = await base44.entities.InvoiceIntakeRaw.filter({ id: row.source_intake });
        if (list && list[0]?.file) setIntakeFile(list[0].file);
      } catch (_) {}
    }
  };

  const closeDialog = () => { setSelected(null); setIntakeFile(null); };

  const VAT_RATE = 0.18;

  // Extract line items from AI JSON
  const getLineItems = (row) => {
    try {
      const extraction = row?.ai_debug_last_extraction_json ? JSON.parse(row.ai_debug_last_extraction_json) : null;
      return extraction?.line_items || [];
    } catch { return []; }
  };

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Filter className="w-6 h-6"/> ריכוז חשבוניות</h1>
        <Button variant="outline" onClick={load} className="gap-2">רענן</Button>
      </div>

      {/* Filters bar */}
      <Card className="glass-card border-0">
        <CardContent className="p-4 space-y-3">
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
            {dateRange === 'custom' && (
              <div className="flex items-center gap-2 mt-2 md:mt-0">
                <div className="flex items-center gap-1">
                  <Label className="text-sm">מ:</Label>
                  <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-36" />
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-sm">עד:</Label>
                  <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-36" />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input placeholder="חיפוש ספק/מספר מסמך" value={searchText} onChange={e => setSearchText(e.target.value)} className="pr-8 w-[220px]" />
            </div>
            <Select value={filterSupplier} onValueChange={setFilterSupplier}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="כל הספקים" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הספקים</SelectItem>
                {suppliersList.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="כל הסטטוסים" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסטטוסים</SelectItem>
                <SelectItem value="ממתין לאימות">ממתין לאימות</SelectItem>
                <SelectItem value="נקרא בהצלחה">נקרא בהצלחה</SelectItem>
                <SelectItem value="אושר">אושר</SelectItem>
                <SelectItem value="נדחה">נדחה</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterDocType} onValueChange={setFilterDocType}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="סוג מסמך" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסוגים</SelectItem>
                <SelectItem value="חשבונית מס">חשבונית מס</SelectItem>
                <SelectItem value="חשבונית זיכוי">חשבונית זיכוי</SelectItem>
              </SelectContent>
            </Select>
            {(filterSupplier !== 'all' || filterStatus !== 'all' || filterDocType !== 'all' || searchText || dateRange === 'custom') && (
              <Button variant="ghost" size="sm" className="text-gray-600" onClick={() => { setFilterSupplier('all'); setFilterStatus('all'); setFilterDocType('all'); setSearchText(''); setDateRange('month'); setCustomFrom(''); setCustomTo(''); }}>
                נקה סינון <X className="w-3 h-3 mr-1" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass-card border-0">
        <CardHeader>
          <CardTitle>חשבוניות ({filteredRows.length})</CardTitle>
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
                  <th className="text-right py-2 px-2">סה"כ כולל</th>
                  <th className="text-right py-2 px-2">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-6 text-gray-500">טוען...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-6 text-gray-500">אין נתונים לטווח ולסינון הנוכחיים</td></tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.id} className={`border-b hover:bg-gray-50 cursor-pointer ${r.supplier ? supplierColors[r.supplier] : ''}`} onClick={() => openRow(r)}>
                      <td className="py-2 px-2">{suppliersMap[r.supplier]?.name || r.supplier || '-'}</td>
                      <td className="py-2 px-2">{r.doc_type || '-'}</td>
                      <td className="py-2 px-2 font-mono">{r.doc_number || '-'}</td>
                      <td className="py-2 px-2">{r.doc_date || '-'}</td>
                      <td className="py-2 px-2 font-semibold">{r.total_with_vat != null ? `₪${r.total_with_vat.toLocaleString()}` : '-'}</td>
                      <td className="py-2 px-2">
                        <Badge variant={r.extraction_status === 'אושר' ? 'default' : 'outline'}>
                          {r.extraction_status || '-'}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Details dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-[95vw] w-[1500px] max-h-[90vh] overflow-hidden p-0" dir="rtl">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              פירוט חשבונית
              {selected?.doc_number && (
                <span className="text-xs text-gray-500">מס' {selected.doc_number}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="flex h-[calc(90vh-80px)]">
              {/* Right side - viewer */}
              <div className="w-[48%] border-l flex flex-col bg-gray-100">
                <div className="p-2 border-b bg-white flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">תצוגת מסמך מקור</span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setImageZoom(Math.max(25, imageZoom - 25))}><ZoomOut className="w-4 h-4" /></Button>
                    <span className="text-xs text-gray-500 w-12 text-center">{imageZoom}%</span>
                    <Button variant="ghost" size="sm" onClick={() => setImageZoom(Math.min(300, imageZoom + 25))}><ZoomIn className="w-4 h-4" /></Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
                  {intakeFile ? (
                    (() => {
                      const lowerFile = intakeFile.toLowerCase();
                      const isPdf = lowerFile.includes('.pdf') || lowerFile.includes('application/pdf');
                      if (isPdf) {
                        return (
                          <iframe 
                            src={intakeFile + '#toolbar=1&navpanes=0'}
                            className="w-full h-full border-0 bg-white rounded shadow-lg"
                            title="Document preview"
                            style={{ minHeight: '600px' }}
                          />
                        );
                      }
                      return (
                        <img 
                          src={intakeFile} 
                          alt="Invoice document" 
                          style={{ width: `${imageZoom}%`, maxWidth: 'none' }}
                          className="object-contain shadow-lg bg-white"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      );
                    })()
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <FileText className="w-20 h-20 mb-4" />
                      <span className="text-lg">אין מסמך מקור זמין</span>
                      <span className="text-sm mt-1">ייתכן שהמסמך לא הועלה או נמחק</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Left side - details */}
              <div className="flex-1 flex flex-col bg-white">
                <div className="p-4 grid grid-cols-2 gap-3 border-b bg-gray-50">
                  <div>
                    <div className="text-xs text-gray-500">ספק</div>
                    <div className="font-medium">{suppliersMap[selected.supplier]?.name || selected.supplier || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">ח.פ.</div>
                    <div className="font-mono text-sm">
                      {(() => { try { const ex = selected.ai_debug_last_extraction_json ? JSON.parse(selected.ai_debug_last_extraction_json) : null; return ex?.supplier_vat_id || '-'; } catch { return '-'; } })()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">תאריך</div>
                    <div>{selected.doc_date || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">סה"כ כולל מע"מ</div>
                    <div className="font-semibold">{selected.total_with_vat != null ? `₪${selected.total_with_vat.toLocaleString()}` : '-'}</div>
                  </div>
                </div>

                <div className="p-4">
                  <div className="text-sm font-medium mb-2">פרטי פריטים</div>
                  <div className="space-y-2 max-h-[58vh] overflow-y-auto">
                    {(() => {
                      const items = getLineItems(selected);
                      if (!items || items.length === 0) {
                        return <div className="text-gray-500 text-sm">אין פריטים מזוהים</div>;
                      }
                      return items.map((item, idx) => {
                        let unitBefore = item.unit_price_before_vat;
                        let lineBefore = item.line_total_before_vat;
                        let lineWith = item.line_total_with_vat;
                        const qty = item.quantity || 1;

                        if (lineWith && !lineBefore) lineBefore = lineWith / (1 + VAT_RATE);
                        if (lineBefore && !lineWith) lineWith = lineBefore * (1 + VAT_RATE);
                        if (!unitBefore && lineBefore && qty) unitBefore = lineBefore / qty;
                        if (unitBefore && !lineBefore) { lineBefore = unitBefore * qty; lineWith = lineBefore * (1 + VAT_RATE); }
                        const unitWith = unitBefore ? unitBefore * (1 + VAT_RATE) : null;

                        return (
                          <div key={idx} className="bg-gray-50 rounded p-2 text-xs border">
                            <div className="flex justify-between items-start mb-1">
                              <span className="font-medium text-gray-800 flex-1 truncate" title={item.product_name}>
                                {item.product_name || 'ללא שם'}
                              </span>
                              {item.sku && (
                                <span className="text-gray-400 font-mono mr-2 text-[10px]">מק"ט: {item.sku}</span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-gray-600">
                              <div>כמות: <span className="font-medium">{qty}</span></div>
                              <div>מחיר/יח' לפני: <span className="font-medium">{unitBefore ? `₪${unitBefore.toFixed(2)}` : '-'}</span></div>
                              <div>סה"כ לפני מע"מ: <span className="font-medium">{lineBefore ? `₪${lineBefore.toFixed(2)}` : '-'}</span></div>
                              <div>סה"כ כולל מע"מ: <span className="font-medium text-green-700">{lineWith ? `₪${lineWith.toFixed(2)}` : '-'}</span></div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                <div className="p-4 border-t bg-gray-50">
                  <Button variant="ghost" onClick={closeDialog} className="w-full">סגור</Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}