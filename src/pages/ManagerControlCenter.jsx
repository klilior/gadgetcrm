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
  BarChart3, RefreshCw, Users, Filter, Smartphone, Radio, 
  ShoppingBag, TrendingUp, Download, Search, RotateCcw,
  DollarSign, CreditCard, Package, Percent, FileText, Building2, AlertCircle
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, subDays, startOfWeek, endOfWeek, startOfYear } from "date-fns";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Legend } from 'recharts';
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import useSuppliers from "../components/hooks/useSuppliers";
import UndeliveredOrdersWidget from "../components/dashboard/UndeliveredOrdersWidget";
import QuickLeadsToComplete from "../components/dashboard/QuickLeadsToComplete";

// Ratio thresholds for color coding
const RATIO_THRESHOLDS = { good: 40, warning: 60 }; // green < 40%, orange 40-60%, red > 60%

export default function ManagerControlCenter() {
  const { currentUser } = useUser();
  const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  // Data states
  const [sales, setSales] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [pendingInvoicesCount, setPendingInvoicesCount] = useState(0);
  const { suppliersMap, suppliersList } = useSuppliers();
  const [isLoading, setIsLoading] = useState(false);
  const [quickLeads, setQuickLeads] = useState([]);

  // Global filters
  const [datePreset, setDatePreset] = useState("thisMonth");
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedRep, setSelectedRep] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedSupplier, setSelectedSupplier] = useState("all");
  const [availableReps, setAvailableReps] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);

  // Table states
  const [repSearch, setRepSearch] = useState("");
  const [repSortField, setRepSortField] = useState("total_net");
  const [repSortDir, setRepSortDir] = useState("desc");
  const [supplierSearch, setSupplierSearch] = useState("");

  // Authorization check
  if (!isManager) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
        <p className="text-gray-600 mt-2">דף זה זמין למנהלים בלבד</p>
      </div>
    );
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, selectedRep, selectedCategory, selectedSupplier]);

  const loadInitialData = async () => {
    try {
      const [mappingsData, pendingInvoices] = await Promise.all([
        base44.entities.CommissionGroupMapping.filter({ is_active: true }),
        base44.entities.Invoices.filter({ extraction_status: { "$in": ["ממתין לאימות", "נקרא בהצלחה"] } }, "-doc_date", 200)
      ]);
      setMappings(mappingsData);
      // Count only invoices with actual data
      const filtered = (pendingInvoices || []).filter(inv => 
        inv.supplier || inv.doc_number || inv.total_with_vat || inv.doc_date
      );
      setPendingInvoicesCount(filtered.length);
    } catch (e) {
      console.error("Error loading mappings:", e);
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load sales
      let salesQuery = { issue_date: { $gte: dateFrom, $lte: dateTo } };
      if (selectedRep !== "all") salesQuery.sales_rep = selectedRep;
      
      const salesData = await base44.entities.SalesTransaction.filter(salesQuery, '-issue_date', 10000);
      
      // Filter by category if selected
      let filteredSales = salesData;
      if (selectedCategory !== "all") {
        const categoryMapping = { 'devices': 'DEVICES', 'lines': 'LINES', 'accessories': 'ACCESSORIES_GROUP' };
        filteredSales = salesData.filter(s => getCommissionGroup(s) === categoryMapping[selectedCategory]);
      }
      
      setSales(filteredSales);

      // Extract available reps and categories
      const reps = [...new Set(salesData.map(s => s.sales_rep).filter(Boolean))].sort();
      setAvailableReps(reps);
      
      const cats = [...new Set(salesData.map(s => s.category).filter(Boolean))].sort();
      setAvailableCategories(cats);

      // Load invoices (approved only for calculations)
      let invoiceQuery = { 
        doc_date: { $gte: dateFrom, $lte: dateTo },
        extraction_status: 'אושר'
      };
      if (selectedSupplier !== "all") invoiceQuery.supplier = selectedSupplier;
      
      const invoicesData = await base44.entities.Invoices.filter(invoiceQuery, '-doc_date', 2000);
      setInvoices(invoicesData);

      // Quick leads to complete (global for managers)
      try {
        const allLeads = await base44.entities.Lead.filter({ status: { $ne: 'Deleted' } });
        const quickIncomplete = (allLeads || [])
          .filter(l => l.quick_incomplete === true && l.status !== 'Closed')
          .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        setQuickLeads(quickIncomplete);
      } catch (e) {
        console.error('Error loading quick leads:', e);
        setQuickLeads([]);
      }
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDatePreset = (preset) => {
    setDatePreset(preset);
    const today = new Date();
    let from, to;
    
    switch (preset) {
      case 'today':
        from = today; to = today; break;
      case 'yesterday':
        from = subDays(today, 1); to = subDays(today, 1); break;
      case 'last7days':
        from = subDays(today, 6); to = today; break;
      case 'thisMonth':
        from = startOfMonth(today); to = endOfMonth(today); break;
      case 'lastMonth':
        from = startOfMonth(subMonths(today, 1)); to = endOfMonth(subMonths(today, 1)); break;
      case 'custom':
        return;
      default:
        return;
    }
    
    setDateFrom(format(from, 'yyyy-MM-dd'));
    setDateTo(format(to, 'yyyy-MM-dd'));
  };

  const resetFilters = () => {
    handleDatePreset('thisMonth');
    setSelectedRep("all");
    setSelectedCategory("all");
    setSelectedSupplier("all");
    setRepSearch("");
    setSupplierSearch("");
  };

  // Commission group detection
  const getCommissionGroup = (sale) => {
    for (const mapping of mappings.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
      if (checkFilters(sale, mapping.filters_json)) {
        return mapping.commission_group_code;
      }
    }
    return null;
  };

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

  // KPI Calculations
  const kpiData = useMemo(() => {
    // Deduplicate sales
    const uniqueSales = [];
    const seenKeys = new Set();
    for (const sale of sales) {
      const key = `${sale.doc_number || ''}_${sale.sku || ''}_${sale.product_name || ''}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueSales.push(sale);
      }
    }

    const isCredit = (s) => s.doc_type?.includes('זיכוי') || s.doc_type === '3';
    
    let grossSales = 0, netSales = 0, creditsTotal = 0;
    let devicesUnits = 0, linesUnits = 0, accessoriesNet = 0;

    uniqueSales.forEach(s => {
      const gross = s.total_row_amount || 0;
      const net = s.price_ex_vat || 0;
      const qty = Math.abs(s.quantity || 0);
      const group = getCommissionGroup(s);

      if (isCredit(s)) {
        creditsTotal += Math.abs(gross);
        netSales -= Math.abs(net);
        grossSales -= Math.abs(gross);
      } else {
        grossSales += gross;
        netSales += net;
      }

      if (group === 'DEVICES') devicesUnits += qty;
      else if (group === 'LINES') linesUnits += qty;
      else if (group === 'ACCESSORIES_GROUP') accessoriesNet += net;
    });

    // Purchases calculations
    const purchasesInvoices = invoices.filter(i => i.doc_type === 'חשבונית מס');
    const purchasesTotal = purchasesInvoices.reduce((acc, i) => acc + (Number(i.total_with_vat) || 0), 0);
    
    const ratio = grossSales > 0 ? (purchasesTotal / grossSales) * 100 : 0;

    return {
      netSales: Math.round(netSales),
      grossSales: Math.round(grossSales),
      creditsTotal: Math.round(creditsTotal),
      devicesUnits,
      linesUnits,
      accessoriesNet: Math.round(accessoriesNet),
      purchasesTotal: Math.round(purchasesTotal),
      ratio: ratio.toFixed(1)
    };
  }, [sales, invoices, mappings]);

  // Rep performance data
  const repPerformance = useMemo(() => {
    const uniqueSales = [];
    const seenKeys = new Set();
    for (const sale of sales) {
      const key = `${sale.doc_number || ''}_${sale.sku || ''}_${sale.product_name || ''}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueSales.push(sale);
      }
    }

    const perfMap = {};
    uniqueSales.forEach(s => {
      const rep = s.sales_rep || 'לא משויך';
      if (!perfMap[rep]) {
        perfMap[rep] = { rep_name: rep, total_net: 0, devices_units: 0, lines_units: 0, accessories_net: 0 };
      }
      
      const net = s.price_ex_vat || 0;
      const qty = Math.abs(s.quantity || 0);
      const group = getCommissionGroup(s);
      const isCredit = s.doc_type?.includes('זיכוי') || s.doc_type === '3';
      
      perfMap[rep].total_net += isCredit ? -Math.abs(net) : net;
      
      if (group === 'DEVICES') perfMap[rep].devices_units += qty;
      else if (group === 'LINES') perfMap[rep].lines_units += qty;
      else if (group === 'ACCESSORIES_GROUP') perfMap[rep].accessories_net += isCredit ? -Math.abs(net) : net;
    });

    let result = Object.values(perfMap);
    
    // Search filter
    if (repSearch) {
      result = result.filter(r => r.rep_name.toLowerCase().includes(repSearch.toLowerCase()));
    }
    
    // Sort
    result.sort((a, b) => {
      const aVal = a[repSortField] || 0;
      const bVal = b[repSortField] || 0;
      return repSortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [sales, mappings, repSearch, repSortField, repSortDir]);

  // Daily chart data
  const dailyChartData = useMemo(() => {
    const dayMap = {};
    
    // Sales by day
    sales.forEach(s => {
      if (!s.issue_date) return;
      const day = format(new Date(s.issue_date), 'dd/MM');
      if (!dayMap[day]) dayMap[day] = { name: day, sales: 0, purchases: 0 };
      const isCredit = s.doc_type?.includes('זיכוי') || s.doc_type === '3';
      dayMap[day].sales += isCredit ? -Math.abs(s.price_ex_vat || 0) : (s.price_ex_vat || 0);
    });

    // Purchases by day
    invoices.filter(i => i.doc_type === 'חשבונית מס').forEach(inv => {
      if (!inv.doc_date) return;
      const day = format(new Date(inv.doc_date), 'dd/MM');
      if (!dayMap[day]) dayMap[day] = { name: day, sales: 0, purchases: 0 };
      dayMap[day].purchases += Number(inv.total_with_vat) || 0;
    });

    return Object.values(dayMap).sort((a, b) => {
      const [dayA, monthA] = a.name.split('/').map(Number);
      const [dayB, monthB] = b.name.split('/').map(Number);
      return monthA !== monthB ? monthA - monthB : dayA - dayB;
    });
  }, [sales, invoices]);

  // Top suppliers
  const topSuppliers = useMemo(() => {
    const supplierMap = {};
    const total = invoices.filter(i => i.doc_type === 'חשבונית מס')
      .reduce((acc, i) => acc + (Number(i.total_with_vat) || 0), 0);

    invoices.filter(i => i.doc_type === 'חשבונית מס').forEach(inv => {
      const supplierId = inv.supplier || 'unknown';
      if (!supplierMap[supplierId]) {
        supplierMap[supplierId] = { 
          id: supplierId, 
          name: suppliersMap[supplierId]?.name || supplierId, 
          total: 0 
        };
      }
      supplierMap[supplierId].total += Number(inv.total_with_vat) || 0;
    });

    let result = Object.values(supplierMap)
      .map(s => ({ ...s, percent: total > 0 ? ((s.total / total) * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    if (supplierSearch) {
      result = result.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase()));
    }

    return result;
  }, [invoices, suppliersMap, supplierSearch]);

  // CSV Export
  const exportCsv = (data, filename, columns) => {
    const header = columns.map(c => c.label).join(',');
    const rows = data.map(row => columns.map(c => row[c.key] ?? '').join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getRatioColor = (ratio) => {
    const val = parseFloat(ratio);
    if (val < RATIO_THRESHOLDS.good) return 'text-green-600 bg-green-100';
    if (val < RATIO_THRESHOLDS.warning) return 'text-orange-600 bg-orange-100';
    return 'text-red-600 bg-red-100';
  };

  const handleRepSort = (field) => {
    if (repSortField === field) {
      setRepSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setRepSortField(field);
      setRepSortDir('desc');
    }
  };

  const navigateToSalesReport = (rep = null) => {
    let url = createPageUrl("SalesDashboard");
    // Could add query params if supported
    window.location.href = url;
  };

  const navigateToPurchases = (supplierId = null) => {
    let url = createPageUrl("PurchasesDashboard");
    window.location.href = url;
  };

  const handleLeadStatusChange = async (leadId, newStatus) => {
    try {
      const lead = (quickLeads || []).find(l => l.id === leadId);
      const updateData = { status: newStatus };
      if (newStatus === 'Deleted') {
        updateData.deleted_at = new Date().toISOString();
      }
      if ((newStatus === 'InProgress' || newStatus === 'Closed') && lead?.quick_incomplete) {
        updateData.quick_incomplete = false;
        updateData.capture_type = 'Full';
      }
      await base44.entities.Lead.update(leadId, updateData);
      await loadData();
    } catch (e) {
      console.error('Error updating lead status:', e);
    }
  };

  return (
    <div className="p-3 md:p-6 space-y-4" style={{ background: 'linear-gradient(135deg, #F8F9FB 0%, #E8ECFF 100%)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-indigo-600" />
            מרכז בקרה למנהל
          </h1>
          <p className="text-gray-600 text-sm mt-1">סקירה כוללת: מכירות, ביצועי נציגים ורכישות</p>
        </div>
        <Button onClick={loadData} disabled={isLoading} variant="outline" size="sm">
          <RefreshCw className={`w-4 h-4 ml-2 ${isLoading ? 'animate-spin' : ''}`} />
          רענן
        </Button>
      </div>

      {/* Sticky Filter Bar */}
      <Card className="glass-card border-0 sticky top-0 z-30 shadow-md">
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Date Preset */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">תקופה</label>
              <Select value={datePreset} onValueChange={handleDatePreset}>
                <SelectTrigger className="w-[130px] bg-white text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">היום</SelectItem>
                  <SelectItem value="yesterday">אתמול</SelectItem>
                  <SelectItem value="last7days">7 ימים</SelectItem>
                  <SelectItem value="thisMonth">החודש</SelectItem>
                  <SelectItem value="lastMonth">חודש שעבר</SelectItem>
                  <SelectItem value="custom">מותאם</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom Date Range */}
            {datePreset === 'custom' && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">מ-</label>
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-32 h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">עד</label>
                  <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-32 h-9 text-sm" />
                </div>
              </>
            )}

            {/* Rep Filter */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">נציג</label>
              <Select value={selectedRep} onValueChange={setSelectedRep}>
                <SelectTrigger className="w-[140px] bg-white text-sm h-9">
                  <SelectValue placeholder="כל הנציגים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הנציגים</SelectItem>
                  {availableReps.map(rep => (
                    <SelectItem key={rep} value={rep}>{rep}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Category Filter */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">קבוצה</label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[120px] bg-white text-sm h-9">
                  <SelectValue placeholder="הכל" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">הכל</SelectItem>
                  <SelectItem value="devices">מכשירים</SelectItem>
                  <SelectItem value="lines">קווים</SelectItem>
                  <SelectItem value="accessories">אביזרים</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Supplier Filter */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">ספק (רכישות)</label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger className="w-[150px] bg-white text-sm h-9">
                  <SelectValue placeholder="כל הספקים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הספקים</SelectItem>
                  {suppliersList.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reset */}
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9">
              <RotateCcw className="w-4 h-4 ml-1" />
              איפוס
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pending Invoices Alert */}
      {pendingInvoicesCount > 0 && (
        <Link to={createPageUrl("InvoicesToReview")}>
          <Card className="border-0 shadow-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 transition-all cursor-pointer">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-full p-2">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-lg">{pendingInvoicesCount} חשבוניות ממתינות לאימות</p>
                  <p className="text-white/80 text-sm">לחץ כאן לעבור לרשימת החשבוניות</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="bg-white text-orange-600 hover:bg-white/90">
                עבור לאימות →
              </Button>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Undelivered Orders Widget */}
      <UndeliveredOrdersWidget 
        currentUser={currentUser}
        isManager={true}
        employees={[]}
        compact={false}
      />

      {/* Quick Leads to Complete */}
      <QuickLeadsToComplete
        leads={quickLeads}
        onProcess={(id) => handleLeadStatusChange(id, 'InProgress')}
        onClose={(id) => handleLeadStatusChange(id, 'Closed')}
        onDelete={(id) => handleLeadStatusChange(id, 'Deleted')}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-600 to-emerald-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-emerald-200" />
              <span className="text-xs text-emerald-100">מכירות נטו</span>
            </div>
            <p className="text-lg md:text-xl font-bold">₪{kpiData.netSales.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-600 to-blue-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-200" />
              <span className="text-xs text-blue-100">מכירות ברוטו</span>
            </div>
            <p className="text-lg md:text-xl font-bold">₪{kpiData.grossSales.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-red-600 to-red-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-red-200" />
              <span className="text-xs text-red-100">זיכויים/החזרים</span>
            </div>
            <p className="text-lg md:text-xl font-bold">₪{kpiData.creditsTotal.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-600 to-indigo-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="w-4 h-4 text-indigo-200" />
              <span className="text-xs text-indigo-100">מכשירים</span>
            </div>
            <p className="text-lg md:text-xl font-bold">{kpiData.devicesUnits}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-green-600 to-green-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Radio className="w-4 h-4 text-green-200" />
              <span className="text-xs text-green-100">קווים</span>
            </div>
            <p className="text-lg md:text-xl font-bold">{kpiData.linesUnits}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-600 to-purple-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag className="w-4 h-4 text-purple-200" />
              <span className="text-xs text-purple-100">אביזרים נטו</span>
            </div>
            <p className="text-lg md:text-xl font-bold">₪{kpiData.accessoriesNet.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-600 to-orange-500 text-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-orange-200" />
              <span className="text-xs text-orange-100">רכישות כולל</span>
            </div>
            <p className="text-lg md:text-xl font-bold">₪{kpiData.purchasesTotal.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-500">יחס רכישות/מכירות</span>
            </div>
            <p className={`text-lg md:text-xl font-bold rounded px-2 py-0.5 inline-block ${getRatioColor(kpiData.ratio)}`}>
              {kpiData.ratio}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sales Overview - Left */}
        <Card className="glass-card border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              סקירת מכירות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis fontSize={10} tickFormatter={v => `₪${(v/1000).toFixed(0)}k`} width={50} />
                  <RechartsTooltip formatter={(v) => `₪${v.toLocaleString()}`} />
                  <Line type="monotone" dataKey="sales" stroke="#3B82F6" strokeWidth={2} name="מכירות נטו" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Top Reps Mini Table */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700">נציגים מובילים</span>
              <div className="flex gap-2">
                <Input 
                  placeholder="חיפוש..." 
                  value={repSearch} 
                  onChange={e => setRepSearch(e.target.value)} 
                  className="w-32 h-7 text-xs"
                />
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 px-2"
                  onClick={() => exportCsv(repPerformance, 'reps_performance.csv', [
                    { key: 'rep_name', label: 'נציג' },
                    { key: 'total_net', label: 'מכירות נטו' },
                    { key: 'devices_units', label: 'מכשירים' },
                    { key: 'lines_units', label: 'קווים' },
                    { key: 'accessories_net', label: 'אביזרים' }
                  ])}
                >
                  <Download className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs cursor-pointer" onClick={() => handleRepSort('rep_name')}>נציג</TableHead>
                    <TableHead className="text-xs text-left cursor-pointer" onClick={() => handleRepSort('total_net')}>נטו ₪</TableHead>
                    <TableHead className="text-xs text-center cursor-pointer" onClick={() => handleRepSort('devices_units')}>מכשירים</TableHead>
                    <TableHead className="text-xs text-center cursor-pointer" onClick={() => handleRepSort('lines_units')}>קווים</TableHead>
                    <TableHead className="text-xs text-left cursor-pointer" onClick={() => handleRepSort('accessories_net')}>אביזרים</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repPerformance.slice(0, 10).map(r => (
                    <TableRow 
                      key={r.rep_name} 
                      className="hover:bg-blue-50 cursor-pointer"
                      onClick={() => navigateToSalesReport(r.rep_name)}
                    >
                      <TableCell className="text-xs font-medium">{r.rep_name}</TableCell>
                      <TableCell className="text-xs text-left font-bold text-blue-600">₪{r.total_net.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-center">{r.devices_units}</TableCell>
                      <TableCell className="text-xs text-center">{r.lines_units}</TableCell>
                      <TableCell className="text-xs text-left">₪{r.accessories_net.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Rep Performance - Right */}
        <Card className="glass-card border-0">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                ביצועי נציגים
              </CardTitle>
              <Link to={createPageUrl("AgentPerformanceDashboard")}>
                <Button variant="outline" size="sm" className="h-7 text-xs">צפה בפירוט</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={repPerformance.slice(0, 8).map(r => ({ name: r.rep_name, value: r.total_net }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={9} angle={-20} textAnchor="end" height={50} />
                  <YAxis fontSize={10} tickFormatter={v => `₪${(v/1000).toFixed(0)}k`} width={50} />
                  <RechartsTooltip formatter={(v) => `₪${v.toLocaleString()}`} />
                  <Bar dataKey="value" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Full Rep Table */}
            <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">נציג</TableHead>
                    <TableHead className="text-xs text-center">
                      <Smartphone className="w-3 h-3 inline ml-1" />מכשירים
                    </TableHead>
                    <TableHead className="text-xs text-center">
                      <Radio className="w-3 h-3 inline ml-1" />קווים
                    </TableHead>
                    <TableHead className="text-xs text-left">
                      <ShoppingBag className="w-3 h-3 inline ml-1" />אביזרים
                    </TableHead>
                    <TableHead className="text-xs text-left font-bold">סה״כ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repPerformance.map(r => (
                    <TableRow 
                      key={r.rep_name}
                      className="hover:bg-indigo-50 cursor-pointer"
                      onClick={() => navigateToSalesReport(r.rep_name)}
                    >
                      <TableCell className="text-xs font-medium">{r.rep_name}</TableCell>
                      <TableCell className="text-xs text-center text-blue-600 font-bold">{r.devices_units}</TableCell>
                      <TableCell className="text-xs text-center text-green-600 font-bold">{r.lines_units}</TableCell>
                      <TableCell className="text-xs text-left text-purple-600">₪{r.accessories_net.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-left font-bold">₪{r.total_net.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Purchases Control - Full Width */}
      <Card className="glass-card border-0">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-600" />
              בקרת רכישות (חשבוניות מאושרות)
            </CardTitle>
            <Link to={createPageUrl("PurchasesDashboard")}>
              <Button variant="outline" size="sm" className="h-7 text-xs">צפה בדשבורד רכישות</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Dual Line Chart */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">מכירות vs רכישות (יומי)</p>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis fontSize={10} tickFormatter={v => `₪${(v/1000).toFixed(0)}k`} width={50} />
                    <RechartsTooltip formatter={(v) => `₪${v.toLocaleString()}`} />
                    <Legend />
                    <Line type="monotone" dataKey="sales" stroke="#3B82F6" strokeWidth={2} name="מכירות ברוטו" dot={false} />
                    <Line type="monotone" dataKey="purchases" stroke="#F97316" strokeWidth={2} name="רכישות ברוטו" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top Suppliers */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Top 10 ספקים</p>
                <div className="flex gap-2">
                  <Input 
                    placeholder="חיפוש ספק..." 
                    value={supplierSearch} 
                    onChange={e => setSupplierSearch(e.target.value)} 
                    className="w-32 h-7 text-xs"
                  />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 px-2"
                    onClick={() => exportCsv(topSuppliers, 'top_suppliers.csv', [
                      { key: 'name', label: 'ספק' },
                      { key: 'total', label: 'סכום' },
                      { key: 'percent', label: 'אחוז' }
                    ])}
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[200px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">ספק</TableHead>
                      <TableHead className="text-xs text-left">רכישות ברוטו</TableHead>
                      <TableHead className="text-xs text-center">% מסה״כ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topSuppliers.map(s => (
                      <TableRow 
                        key={s.id}
                        className="hover:bg-orange-50 cursor-pointer"
                        onClick={() => navigateToPurchases(s.id)}
                      >
                        <TableCell className="text-xs font-medium">{s.name}</TableCell>
                        <TableCell className="text-xs text-left font-bold text-orange-600">₪{s.total.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-center">
                          <Badge variant="outline" className="text-xs">{s.percent}%</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {topSuppliers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-gray-500 text-xs py-4">אין נתונים</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <Card className="p-6">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
            <p className="text-sm text-gray-600 mt-2">טוען נתונים...</p>
          </Card>
        </div>
      )}
    </div>
  );
}