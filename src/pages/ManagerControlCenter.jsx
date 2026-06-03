import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useUser } from "../components/UserAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, RefreshCw, Smartphone, Radio, ShoppingBag,
  TrendingUp, DollarSign, CreditCard, Package, Percent,
  FileText, AlertCircle, RotateCcw, Phone, PhoneMissed,
  Download, Clock, CheckCircle2
} from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, subDays, subMonths } from "date-fns";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Legend } from 'recharts';
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import useSuppliers from "../components/hooks/useSuppliers";
import UndeliveredOrdersWidget from "../components/dashboard/UndeliveredOrdersWidget";
import QuickLeadsToComplete from "../components/dashboard/QuickLeadsToComplete";
import RepSalesDrilldown from "../components/dashboard/RepSalesDrilldown";
import { getInvoiceClassification } from "../components/utils/invoiceClassification";

const RATIO_THRESHOLDS = { good: 40, warning: 60 };

export default function ManagerControlCenter() {
  const { currentUser } = useUser();
  const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  const [sales, setSales] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [pendingInvoicesCount, setPendingInvoicesCount] = useState(0);
  const { suppliersMap, suppliersList } = useSuppliers();
  const [isLoading, setIsLoading] = useState(true);
  const [quickLeads, setQuickLeads] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [callStats, setCallStats] = useState({ incoming: 0, missed: 0 });

  const [datePreset, setDatePreset] = useState("thisMonth");
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Drilldown state
  const [drilldown, setDrilldown] = useState({ open: false, rep: null, group: null, label: '' });

  const checkFilters = (sale, filters) => {
    if (!filters) return false;
    if (filters.category_in && filters.category_in.length > 0) {
      if (!filters.category_in.includes(sale.category)) return false;
    }
    if (filters.category && sale.category !== filters.category) return false;
    if (filters.product_name_contains) {
      if (!sale.product_name || !sale.product_name.includes(filters.product_name_contains)) return false;
    }
    return true;
  };

  useEffect(() => {
    if (!isManager) return;
    loadAllData();
  }, [dateFrom, dateTo, isManager]);

  const loadAllData = async () => {
    setIsLoading(true);
    const salesQuery = { issue_date: { $gte: dateFrom, $lte: dateTo } };
    const invoiceQuery = { doc_date: { $gte: dateFrom, $lte: dateTo }, extraction_status: 'אושר' };

    const [salesData, mappingsData, invoicesData, pendingInvoices, allLeads, syncLogs, activities] = await Promise.all([
      base44.entities.SalesTransaction.filter(salesQuery, '-issue_date', 2000).catch(() => []),
      mappings.length > 0 ? Promise.resolve(mappings) : base44.entities.CommissionGroupMapping.filter({ is_active: true }).catch(() => []),
      base44.entities.Invoices.filter(invoiceQuery, '-doc_date', 2000).catch(() => []),
      base44.entities.Invoices.filter({ extraction_status: { "$in": ["ממתין לאימות", "נקרא בהצלחה"] } }, "-doc_date", 200).catch(() => []),
      base44.entities.Lead.filter({ status: { $ne: 'Deleted' } }).catch(() => []),
      base44.entities.SyncLog.filter({ sync_key: 'linet_main_sync' }, '-run_started_at', 1).catch(() => []),
      base44.entities.Activity.filter({
        activity_type: { $in: ['שיחה נכנסת', 'שיחה יוצאת'] }
      }, '-created_date', 2000).catch(() => [])
    ]);

    if (mappings.length === 0 && mappingsData.length > 0) setMappings(mappingsData);
    setSales(salesData);
    setInvoices(invoicesData);

    // Last sync
    if (syncLogs.length > 0) setLastSync(syncLogs[0]);

    // Call stats - filter by date range in JS (created_date is a datetime field)
    const callsInRange = activities.filter(a => {
      if (!a.created_date) return false;
      const d = a.created_date.split('T')[0];
      return d >= dateFrom && d <= dateTo;
    });
    const incoming = callsInRange.filter(a => a.activity_type === 'שיחה נכנסת').length;
    const missed = callsInRange.filter(a => a.activity_type === 'שיחה נכנסת' && a.content && (a.content.includes('לא נענתה') || a.content.includes('missed') || a.content.includes('משך: 0 שניות'))).length;
    setCallStats({ incoming, missed });

    // Pending invoices
    const filtered = (pendingInvoices || []).filter(inv =>
      inv.supplier || inv.doc_number || inv.total_with_vat || inv.doc_date
    );
    setPendingInvoicesCount(filtered.length);

    // Quick leads
    const quickIncomplete = (allLeads || [])
      .filter(l => (l.capture_type === 'Quick' || l.quick_incomplete === true) && l.status !== 'Closed')
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    setQuickLeads(quickIncomplete);

    setIsLoading(false);
  };

  const handleDatePreset = (preset) => {
    setDatePreset(preset);
    const today = new Date();
    let from, to;
    switch (preset) {
      case 'today': from = today; to = today; break;
      case 'yesterday': from = subDays(today, 1); to = subDays(today, 1); break;
      case 'thisWeek': from = startOfWeek(today, { weekStartsOn: 0 }); to = today; break;
      case 'thisMonth': from = startOfMonth(today); to = today; break;
      case 'lastMonth': from = startOfMonth(subMonths(today, 1)); to = endOfMonth(subMonths(today, 1)); break;
      case 'thisYear': from = startOfYear(today); to = today; break;
      case 'custom': return;
      default: return;
    }
    setDateFrom(format(from, 'yyyy-MM-dd'));
    setDateTo(format(to, 'yyyy-MM-dd'));
  };

  const getCommissionGroup = (sale) => {
    const sorted = [...mappings].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const mapping of sorted) {
      if (checkFilters(sale, mapping.filters_json)) return mapping.commission_group_code;
    }
    return null;
  };

  // Deduplicated sales — use linet_doc_id + sku as unique key (matches Linet's internal structure)
  const uniqueSales = useMemo(() => {
    const seen = new Set();
    return sales.filter(s => {
      const key = `${s.linet_doc_id || s.id}_${s.sku || ''}_${s.product_name || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [sales]);

  // KPI calculations — amounts from Linet are already signed (credits are negative)
  const kpiData = useMemo(() => {
    let grossSales = 0, netSales = 0, creditsTotal = 0;
    let devicesUnits = 0, linesUnits = 0, accessoriesNet = 0;
    let devicesNet = 0, linesNet = 0;
    const isCredit = (s) => s.doc_type?.includes('זיכוי') || s.doc_type === '3';

    uniqueSales.forEach(s => {
      const gross = s.total_row_amount || 0;
      const net = s.price_ex_vat || 0;
      const qty = s.quantity || 0; // already signed from Linet
      const group = getCommissionGroup(s);

      // Amounts are already signed: positive for sales, negative for credits
      grossSales += gross;
      netSales += net;
      if (isCredit(s)) creditsTotal += Math.abs(gross);

      if (group === 'DEVICES') { devicesUnits += Math.abs(qty); devicesNet += net; }
      else if (group === 'LINES') { linesUnits += Math.abs(qty); linesNet += net; }
      else if (group === 'ACCESSORIES_GROUP') { accessoriesNet += net; }
    });

    const purchasesInvoices = invoices.filter(i => i.doc_type === 'חשבונית מס');
    const purchasesTotal = purchasesInvoices.reduce((acc, i) => acc + (Number(i.total_with_vat) || 0), 0);
    const goodsPurchases = purchasesInvoices.filter(i => getInvoiceClassification(i, suppliersMap).type === 'goods').reduce((acc, i) => acc + (Number(i.total_with_vat) || 0), 0);
    const recurringExpenses = purchasesInvoices.filter(i => getInvoiceClassification(i, suppliersMap).type === 'recurring').reduce((acc, i) => acc + (Number(i.total_with_vat) || 0), 0);
    const otherExpenses = purchasesTotal - goodsPurchases - recurringExpenses;
    const ratio = grossSales > 0 ? (purchasesTotal / grossSales) * 100 : 0;
    const goodsRatio = grossSales > 0 ? (goodsPurchases / grossSales) * 100 : 0;

    // Today's sales (gross with VAT) — already signed
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todaySales = uniqueSales.filter(s => s.issue_date === todayStr);
    const todayGross = todaySales.reduce((acc, s) => acc + (s.total_row_amount || 0), 0);
    const todayNet = todaySales.reduce((acc, s) => acc + (s.price_ex_vat || 0), 0);

    return {
      netSales: Math.round(netSales * 100) / 100, grossSales: Math.round(grossSales * 100) / 100,
      creditsTotal: Math.round(creditsTotal * 100) / 100,
      devicesUnits, linesUnits,
      devicesNet: Math.round(devicesNet), linesNet: Math.round(linesNet),
      accessoriesNet: Math.round(accessoriesNet),
      purchasesTotal: Math.round(purchasesTotal),
      goodsPurchases: Math.round(goodsPurchases),
      recurringExpenses: Math.round(recurringExpenses),
      otherExpenses: Math.round(otherExpenses),
      ratio: ratio.toFixed(1),
      goodsRatio: goodsRatio.toFixed(1),
      todayGross: Math.round(todayGross * 100) / 100,
      todayNet: Math.round(todayNet * 100) / 100
    };
  }, [uniqueSales, invoices, mappings, suppliersMap]);

  // Rep performance
  const repPerformance = useMemo(() => {
    const perfMap = {};
    const isCredit = (s) => s.doc_type?.includes('זיכוי') || s.doc_type === '3';
    uniqueSales.forEach(s => {
      const rep = s.sales_rep || 'לא משויך';
      if (!perfMap[rep]) perfMap[rep] = { rep_name: rep, total_net: 0, devices_units: 0, lines_units: 0, accessories_net: 0, devices_sales: [], lines_sales: [], accessories_sales: [] };
      const net = s.price_ex_vat || 0;
      const qty = Math.abs(s.quantity || 0);
      const group = getCommissionGroup(s);
      const signed = isCredit(s) ? -Math.abs(net) : net;
      perfMap[rep].total_net += signed;
      if (group === 'DEVICES') perfMap[rep].devices_units += qty;
      else if (group === 'LINES') perfMap[rep].lines_units += qty;
      else if (group === 'ACCESSORIES_GROUP') perfMap[rep].accessories_net += signed;
    });
    return Object.values(perfMap).sort((a, b) => b.total_net - a.total_net);
  }, [uniqueSales, mappings]);

  // Daily chart
  const dailyChartData = useMemo(() => {
    const dayMap = {};
    const isCredit = (s) => s.doc_type?.includes('זיכוי') || s.doc_type === '3';
    uniqueSales.forEach(s => {
      if (!s.issue_date) return;
      const day = format(new Date(s.issue_date), 'dd/MM');
      if (!dayMap[day]) dayMap[day] = { name: day, sales: 0, purchases: 0 };
      dayMap[day].sales += isCredit(s) ? -Math.abs(s.price_ex_vat || 0) : (s.price_ex_vat || 0);
    });
    invoices.filter(i => i.doc_type === 'חשבונית מס').forEach(inv => {
      if (!inv.doc_date) return;
      const day = format(new Date(inv.doc_date), 'dd/MM');
      if (!dayMap[day]) dayMap[day] = { name: day, sales: 0, purchases: 0 };
      dayMap[day].purchases += Number(inv.total_with_vat) || 0;
    });
    return Object.values(dayMap).sort((a, b) => {
      const [dA, mA] = a.name.split('/').map(Number);
      const [dB, mB] = b.name.split('/').map(Number);
      return mA !== mB ? mA - mB : dA - dB;
    });
  }, [uniqueSales, invoices]);

  // Top suppliers
  const topSuppliers = useMemo(() => {
    const map = {};
    const total = invoices.filter(i => i.doc_type === 'חשבונית מס').reduce((acc, i) => acc + (Number(i.total_with_vat) || 0), 0);
    invoices.filter(i => i.doc_type === 'חשבונית מס').forEach(inv => {
      const sid = inv.supplier || 'unknown';
      if (!map[sid]) map[sid] = { id: sid, name: suppliersMap[sid]?.name || sid, total: 0 };
      map[sid].total += Number(inv.total_with_vat) || 0;
    });
    return Object.values(map).map(s => ({ ...s, percent: total > 0 ? ((s.total / total) * 100).toFixed(1) : 0 })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [invoices, suppliersMap]);

  const getRatioColor = (ratio) => {
    const val = parseFloat(ratio);
    if (val < RATIO_THRESHOLDS.good) return 'text-green-600 bg-green-100';
    if (val < RATIO_THRESHOLDS.warning) return 'text-orange-600 bg-orange-100';
    return 'text-red-600 bg-red-100';
  };

  const handleLeadStatusChange = async (leadId, newStatus) => {
    const lead = quickLeads.find(l => l.id === leadId);
    const updateData = { status: newStatus };
    if (newStatus === 'Deleted') updateData.deleted_at = new Date().toISOString();
    if ((newStatus === 'InProgress' || newStatus === 'Closed') && lead?.quick_incomplete) {
      updateData.quick_incomplete = false;
      updateData.capture_type = 'Full';
    }
    await base44.entities.Lead.update(leadId, updateData);
    loadAllData();
  };

  const openDrilldown = (rep, groupCode, label) => {
    setDrilldown({ open: true, rep, group: groupCode, label });
  };

  if (!isManager) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
        <p className="text-gray-600 mt-2">דף זה זמין למנהלים בלבד</p>
      </div>
    );
  }

  const syncTime = lastSync?.run_finished_at ? format(new Date(lastSync.run_finished_at), 'dd/MM HH:mm') : null;
  const syncOk = lastSync?.status === 'SUCCESS';

  return (
    <div className="p-3 md:p-6 space-y-4" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-indigo-600" />
            מרכז בקרה למנהל
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-600 text-sm">סקירה כוללת: מכירות, ביצועי נציגים ורכישות</p>
            {syncTime && (
              <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${syncOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {syncOk ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                סנכרון לינט: {syncTime}
              </div>
            )}
          </div>
        </div>
        <Button onClick={loadAllData} disabled={isLoading} variant="outline" size="sm">
          <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
          רענן
        </Button>
      </div>

      {/* Date Filters */}
      <Card className="glass-card border-0 sticky top-0 z-30 shadow-md">
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">תקופה</label>
              <Select value={datePreset} onValueChange={handleDatePreset}>
                <SelectTrigger className="w-[130px] bg-white text-sm h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">היום</SelectItem>
                  <SelectItem value="yesterday">אתמול</SelectItem>
                  <SelectItem value="thisWeek">השבוע</SelectItem>
                  <SelectItem value="thisMonth">החודש</SelectItem>
                  <SelectItem value="lastMonth">חודש שעבר</SelectItem>
                  <SelectItem value="thisYear">השנה</SelectItem>
                  <SelectItem value="custom">תאריך חופשי</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {datePreset === 'custom' && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">מ-</label>
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">עד</label>
                  <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-sm" />
                </div>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => handleDatePreset('thisMonth')} className="h-9">
              <RotateCcw className="w-4 h-4 ml-1" />איפוס
            </Button>
            <div className="text-xs text-gray-500 self-center">{dateFrom} → {dateTo}</div>
          </div>
        </CardContent>
      </Card>

      {/* Pending invoices alert */}
      {pendingInvoicesCount > 0 && (
        <Link to={createPageUrl("InvoicesToReview")}>
          <Card className="border-0 shadow-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 transition-all cursor-pointer">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-full p-2"><AlertCircle className="w-6 h-6" /></div>
                <div>
                  <p className="font-bold text-lg">{pendingInvoicesCount} חשבוניות ממתינות לאימות</p>
                  <p className="text-white/80 text-sm">לחץ לעבור לאימות</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="bg-white text-orange-600 hover:bg-white/90">עבור לאימות →</Button>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-cyan-600 to-cyan-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-cyan-200" />
              <span className="text-xs text-cyan-100">מכירות היום (כולל מע״מ)</span>
            </div>
            <p className="text-xl font-bold">₪{kpiData.todayGross.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-600 to-emerald-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-200" />
              <span className="text-xs text-emerald-100">מכירות בתקופה (כולל מע״מ)</span>
            </div>
            <p className="text-xl font-bold">₪{kpiData.grossSales.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-600 to-orange-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-orange-200" />
              <span className="text-xs text-orange-100">סה״כ הוצאות</span>
            </div>
            <p className="text-xl font-bold">₪{kpiData.purchasesTotal.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Link to={`${createPageUrl("PurchasesDashboard")}?classification=goods`} className="block">
          <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-500 text-white hover:scale-[1.02] transition-transform cursor-pointer">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <ShoppingBag className="w-4 h-4 text-blue-200" />
                <span className="text-xs text-blue-100">קניית סחורה</span>
              </div>
              <p className="text-xl font-bold">₪{kpiData.goodsPurchases.toLocaleString()}</p>
              <p className="text-xs text-blue-100 mt-0.5">{kpiData.goodsRatio}% מהמחזור · לחץ לפירוט</p>
            </CardContent>
          </Card>
        </Link>
        <Link to={`${createPageUrl("PurchasesDashboard")}?classification=recurring`} className="block">
          <Card className="border-0 shadow-lg bg-gradient-to-br from-amber-600 to-amber-500 text-white hover:scale-[1.02] transition-transform cursor-pointer">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-amber-200" />
                <span className="text-xs text-amber-100">הוצאות קבועות</span>
              </div>
              <p className="text-xl font-bold">₪{kpiData.recurringExpenses.toLocaleString()}</p>
              <p className="text-xs text-amber-100 mt-0.5">לחץ לפירוט חשבוניות</p>
            </CardContent>
          </Card>
        </Link>
        <Card className="border-0 shadow-lg bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-500">סה״כ הוצאות %</span>
            </div>
            <p className={`text-xl font-bold rounded px-2 py-0.5 inline-block ${getRatioColor(kpiData.ratio)}`}>{kpiData.ratio}%</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-violet-600 to-violet-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-4 h-4 text-violet-200" />
              <span className="text-xs text-violet-100">שיחות נכנסות</span>
            </div>
            <p className="text-xl font-bold">{callStats.incoming}</p>
            {callStats.missed > 0 && (
              <div className="flex items-center gap-1 mt-1">
                <PhoneMissed className="w-3 h-3 text-red-300" />
                <span className="text-xs text-red-200">{callStats.missed} לא נענו</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sales by type */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-600 to-indigo-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="w-4 h-4 text-indigo-200" />
              <span className="text-xs text-indigo-100">מכשירים</span>
            </div>
            <p className="text-xl font-bold">{kpiData.devicesUnits} <span className="text-sm font-normal">יח׳</span></p>
            <p className="text-xs text-indigo-200 mt-0.5">₪{kpiData.devicesNet.toLocaleString()} נטו</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-600 to-purple-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag className="w-4 h-4 text-purple-200" />
              <span className="text-xs text-purple-100">אביזרים</span>
            </div>
            <p className="text-xl font-bold">₪{kpiData.accessoriesNet.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-green-600 to-green-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Radio className="w-4 h-4 text-green-200" />
              <span className="text-xs text-green-100">קווים</span>
            </div>
            <p className="text-xl font-bold">{kpiData.linesUnits} <span className="text-sm font-normal">קווים</span></p>
            <p className="text-xs text-green-200 mt-0.5">₪{kpiData.linesNet.toLocaleString()} נטו</p>
          </CardContent>
        </Card>
      </div>

      {/* Rep Performance Table */}
      <Card className="glass-card border-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            ביצועי נציגים — לחץ על מספר לפירוט מלא
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">נציג</TableHead>
                  <TableHead className="text-xs text-center"><Smartphone className="w-3 h-3 inline ml-1" />מכשירים</TableHead>
                  <TableHead className="text-xs text-center"><ShoppingBag className="w-3 h-3 inline ml-1" />אביזרים ₪</TableHead>
                  <TableHead className="text-xs text-center"><Radio className="w-3 h-3 inline ml-1" />קווים</TableHead>
                  <TableHead className="text-xs text-left font-bold">סה״כ נטו ₪</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repPerformance.map(r => (
                  <TableRow key={r.rep_name} className="hover:bg-indigo-50">
                    <TableCell className="text-xs font-medium">{r.rep_name}</TableCell>
                    <TableCell className="text-center">
                      <button onClick={() => openDrilldown(r.rep_name, 'DEVICES', 'מכשירים')} className="text-xs font-bold text-blue-600 hover:underline cursor-pointer">
                        {r.devices_units}
                      </button>
                    </TableCell>
                    <TableCell className="text-center">
                      <button onClick={() => openDrilldown(r.rep_name, 'ACCESSORIES_GROUP', 'אביזרים')} className="text-xs font-bold text-purple-600 hover:underline cursor-pointer">
                        ₪{r.accessories_net.toLocaleString()}
                      </button>
                    </TableCell>
                    <TableCell className="text-center">
                      <button onClick={() => openDrilldown(r.rep_name, 'LINES', 'קווים')} className="text-xs font-bold text-green-600 hover:underline cursor-pointer">
                        {r.lines_units}
                      </button>
                    </TableCell>
                    <TableCell className="text-xs text-left font-bold">₪{Math.round(r.total_net).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {repPerformance.length > 0 && (
                  <TableRow className="bg-indigo-50 font-bold">
                    <TableCell className="text-xs">סה״כ</TableCell>
                    <TableCell className="text-xs text-center text-blue-700">{repPerformance.reduce((a, r) => a + r.devices_units, 0)}</TableCell>
                    <TableCell className="text-xs text-center text-purple-700">₪{repPerformance.reduce((a, r) => a + r.accessories_net, 0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-center text-green-700">{repPerformance.reduce((a, r) => a + r.lines_units, 0)}</TableCell>
                    <TableCell className="text-xs text-left text-indigo-700">₪{Math.round(repPerformance.reduce((a, r) => a + r.total_net, 0)).toLocaleString()}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Undelivered orders + Quick notes */}
      <UndeliveredOrdersWidget currentUser={currentUser} isManager={true} employees={[]} compact={false} />

      <QuickLeadsToComplete
        leads={quickLeads}
        onProcess={(id) => handleLeadStatusChange(id, 'InProgress')}
        onClose={(id) => handleLeadStatusChange(id, 'Closed')}
        onDelete={(id) => handleLeadStatusChange(id, 'Deleted')}
      />

      {/* Purchases Dashboard */}
      <Card className="glass-card border-0">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-600" />
              בקרת רכישות
            </CardTitle>
            <Link to={createPageUrl("PurchasesDashboard")}>
              <Button variant="outline" size="sm" className="h-7 text-xs">דשבורד רכישות מלא</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">מכירות vs רכישות (יומי)</p>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis fontSize={10} tickFormatter={v => `₪${(v / 1000).toFixed(0)}k`} width={50} />
                    <RechartsTooltip formatter={(v) => `₪${v.toLocaleString()}`} />
                    <Legend />
                    <Line type="monotone" dataKey="sales" stroke="#3B82F6" strokeWidth={2} name="מכירות נטו" dot={false} />
                    <Line type="monotone" dataKey="purchases" stroke="#F97316" strokeWidth={2} name="רכישות" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Top 10 ספקים</p>
              <div className="overflow-x-auto max-h-[220px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">ספק</TableHead>
                      <TableHead className="text-xs text-left">סכום</TableHead>
                      <TableHead className="text-xs text-center">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topSuppliers.map(s => (
                      <TableRow key={s.id} className="hover:bg-orange-50">
                        <TableCell className="text-xs font-medium">{s.name}</TableCell>
                        <TableCell className="text-xs text-left font-bold text-orange-600">₪{s.total.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-center"><Badge variant="outline" className="text-xs">{s.percent}%</Badge></TableCell>
                      </TableRow>
                    ))}
                    {topSuppliers.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-gray-500 text-xs py-4">אין נתונים</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drilldown Dialog */}
      <RepSalesDrilldown
        open={drilldown.open}
        onClose={() => setDrilldown({ open: false, rep: null, group: null, label: '' })}
        repName={drilldown.rep}
        groupCode={drilldown.group}
        groupLabel={drilldown.label}
        dateFrom={dateFrom}
        dateTo={dateTo}
        mappings={mappings}
        checkFilters={checkFilters}
      />

      {isLoading && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 bg-white/90 backdrop-blur shadow-lg rounded-full px-4 py-2 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
          <span className="text-xs text-gray-600">טוען נתונים...</span>
        </div>
      )}
    </div>
  );
}