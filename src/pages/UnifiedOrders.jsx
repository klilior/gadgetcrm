import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Package, RefreshCw, Loader2, AlertTriangle, MessageCircle, Truck, ChevronDown
} from "lucide-react";
import { useUser } from "../components/UserAuth";
import { base44 } from "@/api/base44Client";
import { updateWooOrderStatus } from "@/functions/updateWooOrderStatus";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import { sendTextMeSMS } from "@/functions/sendTextMeSMS";
import SummaryCards from "../components/unified-orders/SummaryCards";
import OrderFilters from "../components/unified-orders/OrderFilters";
import UnifiedOrderRow from "../components/unified-orders/UnifiedOrderRow";
import PendingProductsSummary from "../components/unified-orders/PendingProductsSummary";
import SendSmsOrderModal from "../components/unified-orders/SendSmsOrderModal";
import { isClosedStatus, getShipmentBlockReason, LINET_ORDER_SKUS } from "../components/unified-orders/OrderStatusConfig";
import CreateShipmentModal from "../components/shipping/CreateShipmentModal";
import SPShipDialog from "../components/superpharm/SPShipDialog";
import SPShipmentSuccessScreen from "../components/superpharm/SPShipmentSuccessScreen";
import SPLinetInvoiceModal from "../components/superpharm/SPLinetInvoiceModal";
import MobileOrderCard from "../components/unified-orders/MobileOrderCard";
import OrderDetailPanel from "../components/unified-orders/OrderDetailPanel";
import CargoShipmentModal from "../components/cargo/CargoShipmentModal";
import PostShipmentConfirmDialog from "../components/unified-orders/PostShipmentConfirmDialog";

const PAGE_SIZE = 25;

export default function UnifiedOrders() {
  const { currentUser } = useUser();
  const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';
  const isShiftManager = currentUser?.app_role === 'מנהל משמרת' || isManager;
  const canBulk = isShiftManager;

  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({ woocommerce: 0, mirakl: 0, linet: 0, total: 0 });
  const [errors, setErrors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showClosed, setShowClosed] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState([]);

  // Modals
  const [smsOrder, setSmsOrder] = useState(null);
  const [shipmentOrder, setShipmentOrder] = useState(null);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [upsSuccessData, setUpsSuccessData] = useState(null);
  const [cargoOrder, setCargoOrder] = useState(null);
  const [postShipmentData, setPostShipmentData] = useState(null); // { order, trackingNumber, carrierHint? }

  // Expanded row
  const [expandedId, setExpandedId] = useState(null);

  // Active shipping providers
  const [activeProviders, setActiveProviders] = useState({ velo: false, cargo: false, getpackage: false });

  // Pagination
  const [page, setPage] = useState(1);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    const errs = [];
    const openWoo = new Set(['processing','on-hold']);
    const openMirakl = new Set(['WAITING_ACCEPTANCE','SHIPPING']);
    const closedWoo = new Set(['refunded','failed']);
    const closedMirakl = new Set(['CLOSED','REFUSED','CANCELED','RECEIVED']);

    // Shared client map (used by WooCommerce and Linet)
    let cM = {};
    try {
      const rawClients = await base44.entities.Client.list(null, 1000);
      for (const c of rawClients) cM[c.id] = c;
    } catch (e) { /* clients will be empty */ }

    // Pre-fetch shipments, GetPackage shipments and SMS logs for tracking/timeline enrichment
    let shipmentsByOrder = {};
    let allShipments = [];
    let gpShipmentsByOrder = {};
    let smsLogs = [];
    try {
      const recentShipments = await base44.entities.Shipment.list('-created_date', 300);
      allShipments = recentShipments;
      for (const s of recentShipments) {
        if (s.tracking_number && s.external_order_number) {
          if (!shipmentsByOrder[s.external_order_number] || s.created_date > shipmentsByOrder[s.external_order_number].created_date) {
            shipmentsByOrder[s.external_order_number] = s;
          }
        }
      }
    } catch (_) {}
    try {
      const gpShipments = await base44.entities.GetPackageShipment.list('-created_date', 300);
      for (const s of gpShipments) {
        if (s.order_id && s.delivery_id && !['cancelled', 'failed', 'draft', 'quote_failed'].includes(s.status)) {
          if (!gpShipmentsByOrder[s.order_id] || s.created_date > gpShipmentsByOrder[s.order_id].created_date) {
            gpShipmentsByOrder[s.order_id] = s;
          }
        }
      }
    } catch (_) {}
    try {
      smsLogs = await base44.entities.NotificationLog.list('-sent_at', 300);
    } catch (_) {}

    const getRelatedShipments = (order) => {
      const keys = [order.order_number, order.external_order_number, order.mirakl_order_id, order.raw_id, order.id, order.client_id]
        .filter(Boolean)
        .map(String);
      return allShipments
        .filter(s => keys.includes(String(s.external_order_number || '')) || keys.includes(String(s.order_id || '')) || keys.includes(String(s.reference || '')) || (order.client_id && s.client_id === order.client_id && keys.includes(String(s.external_order_number || s.reference || ''))))
        .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
    };

    const findOrderSms = (orderNumber, phone) => {
      const candidates = smsLogs.filter(s => {
        const fp = s.fingerprint || '';
        const msg = s.message || '';
        return (phone && s.to_phone === phone) && (
          (orderNumber && fp.includes(orderNumber)) ||
          (orderNumber && msg.includes(String(orderNumber))) ||
          fp.includes('tracking|') || fp.includes('order_sms|')
        );
      });
      return candidates.sort((a, b) => new Date(b.sent_at || b.created_date || 0) - new Date(a.sent_at || a.created_date || 0))[0] || null;
    };

    // WooCommerce
    let woo = [];
    try {
      const [rawOrders, rawProducts] = await Promise.all([
        base44.entities.Order.list('-order_date', 500),
        base44.entities.OrderProduct.list(null, 5000)
      ]);
      const pM = {};
      for (const p of rawProducts) { if (!pM[p.order_id]) pM[p.order_id] = []; pM[p.order_id].push(p); }
      for (const o of rawOrders) {
        if (!showClosed && closedWoo.has(o.status)) continue;
        const c = cM[o.client_id];
        const pr = pM[o.id] || [];
        let billing = {};
        try { billing = JSON.parse(o.raw_data_billing || '{}'); } catch(_){}
        // Resolve tracking: Order entity > Shipment entity > GetPackage
        let trackNum = o.tracking_number || '';
        let trackCarrier = o.tracking_carrier || '';
        let trackUrl = o.tracking_url || '';
        const extNum = o.external_order_number || '';
        
        // Fallback: check Shipment entity by external order number
        if (!trackNum && shipmentsByOrder[extNum]) {
          const sh = shipmentsByOrder[extNum];
          trackNum = sh.tracking_number || '';
          trackCarrier = sh.carrier || '';
        }
        // Fallback: check GetPackage by order ID
        if (!trackNum && gpShipmentsByOrder[o.id]) {
          const gp = gpShipmentsByOrder[o.id];
          trackNum = gp.delivery_id || '';
          trackCarrier = 'getpackage';
          trackUrl = gp.tracking_url || '';
        }
        // Also check GP by "woo_" prefixed ID
        if (!trackNum && gpShipmentsByOrder['woo_' + o.id]) {
          const gp = gpShipmentsByOrder['woo_' + o.id];
          trackNum = gp.delivery_id || '';
          trackCarrier = 'getpackage';
          trackUrl = gp.tracking_url || '';
        }

        const shipment = shipmentsByOrder[extNum] || gpShipmentsByOrder[o.id] || gpShipmentsByOrder['woo_' + o.id] || null;
        const smsLog = findOrderSms(extNum, c?.phone || '');
        woo.push({
          id: 'woo_' + o.id, source: 'woocommerce',
          order_number: extNum, order_date: o.order_date || '',
          customer_name: c?.full_name || '', customer_phone: c?.phone || '',
          customer_email: billing.email || c?.email || '',
          products: pr.map(x => ({name: x.name||'', quantity: x.quantity||1, total: parseFloat(x.total)||0, meta_data: x.meta_data || ''})),
          total: parseFloat(o.total) || 0, shipping_method: o.shipping_method || '',
          status: o.status || '', notes: o.customer_note || '',
          raw_id: o.id, client_id: o.client_id || '', pickup_point_data: o.pickup_point_data, currency: 'ILS',
          shipping_city: billing.city || c?.city || '',
          shipping_street: billing.address_1 || c?.address || '',
          shipping_address_full: [billing.address_1, billing.city, billing.postcode].filter(Boolean).join(', '),
          external_order_number: extNum,
          tracking_number: trackNum,
          tracking_carrier: trackCarrier,
          tracking_url: trackUrl,
          shipment_created_at: shipment?.created_date || '',
          tracking_created_at: shipment?.created_date || '',
          sms_sent_at: smsLog?.sent_at || smsLog?.created_date || '',
          sms_status: smsLog?.status || '',
          sms_event_type: smsLog?.event_type || '',
          related_shipments: getRelatedShipments({ order_number: extNum, external_order_number: extNum, raw_id: o.id, client_id: o.client_id }),
        });
      }
    } catch (e) { errs.push({source: 'woocommerce', message: e.message}); }

    // Mirakl
    let mk = [];
    try {
      const spOrders = await base44.entities.SuperPharmOrder.list('-created_at_mirakl', 200);
      for (const o of spOrders) {
        if (!showClosed && closedMirakl.has(o.order_state)) continue;
        let lines = []; try { lines = JSON.parse(o.order_lines_json || '[]'); } catch(e) {}
        const smsLog = findOrderSms(o.mirakl_order_id || '', o.customer_phone || '');
        mk.push({
          id: 'mirakl_' + o.id, source: 'mirakl',
          order_number: o.mirakl_order_id || '', order_date: o.created_at_mirakl || o.created_date || '',
          customer_name: ((o.customer_first_name||'') + ' ' + (o.customer_last_name||'')).trim(),
          customer_phone: o.customer_phone || '',
          products: lines.map(l => ({name: l.product_title||l.offer_sku||'', quantity: l.quantity||1, total: l.price||0})),
          total: o.total_price || 0, shipping_method: 'superpharm', shipping_city: o.shipping_city || '',
          shipping_street: o.shipping_street || '', shipping_zip: o.shipping_zip || '',
          shipping_address_full: o.shipping_address_full || '',
          status: o.order_state || '', notes: o.notes || '',
          raw_id: o.id, mirakl_order_id: o.mirakl_order_id || '',
          tracking_number: o.tracking_number || '',
          tracking_carrier: o.carrier_name || o.carrier_code || '',
          tracking_url: '',
          shipment_created_at: o.shipped_at || '',
          tracking_created_at: o.shipped_at || '',
          sms_sent_at: smsLog?.sent_at || smsLog?.created_date || '',
          sms_status: smsLog?.status || '',
          sms_event_type: smsLog?.event_type || '',
          linet_invoice_created_at: o.linet_invoice_created_at || '',
          currency: o.currency || 'ILS',
          raw_mirakl_json: o.raw_mirakl_json || '',
          customer_first_name: o.customer_first_name || '',
          customer_last_name: o.customer_last_name || '',
          linet_invoice_doc_id: o.linet_invoice_doc_id || '',
          linet_invoice_doc_number: o.linet_invoice_doc_number || '',
          linet_invoice_pdf_url: o.linet_invoice_pdf_url || '',
          linet_invoice_email_sent: o.linet_invoice_email_sent || false,
          order_lines_json: o.order_lines_json || '[]',
          related_shipments: getRelatedShipments({ order_number: o.mirakl_order_id || '', external_order_number: o.mirakl_order_id || '', mirakl_order_id: o.mirakl_order_id || '' }),
        });
      }
    } catch (e) { errs.push({source: 'mirakl', message: e.message}); }

    // Linet - invoices containing order SKUs
    let lin = [];
    try {
      // Fetch all transactions that have order-marker SKUs
      const allTxns = [];
      for (const sku of LINET_ORDER_SKUS) {
        const txns = await base44.entities.SalesTransaction.filter({ sku }, '-issue_date', 200);
        allTxns.push(...txns);
      }
      // Only include invoices from today (2026-03-28) onwards
      const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const orderDocNumbers = new Set();
      const docMeta = {};
      for (const t of allTxns) {
        if (t.doc_type === 'חשבונית זיכוי') continue; // skip credit notes
        if (t.issue_date && t.issue_date < todayStr) continue; // only from today onwards
        orderDocNumbers.add(t.doc_number);
        if (!docMeta[t.doc_number]) {
          docMeta[t.doc_number] = {
            customer_name: t.customer_name || '', issue_date: t.issue_date || '',
            linet_doc_id: t.linet_doc_id || '', client_id: t.client_id || '',
            linet_account_id: t.linet_account_id, sales_rep: t.sales_rep || ''
          };
        }
      }
      // Fetch all transaction lines for those doc_numbers to build product lists
      const docProducts = {};
      const docTotals = {};
      for (const dn of orderDocNumbers) {
        const lines = await base44.entities.SalesTransaction.filter({ doc_number: dn }, null, 50);
        docProducts[dn] = [];
        docTotals[dn] = 0;
        for (const l of lines) {
          if (LINET_ORDER_SKUS.includes(l.sku)) continue; // skip the order-marker line itself
          if (l.doc_type === 'חשבונית זיכוי') continue;
          docProducts[dn].push({ name: l.product_name || '', quantity: l.quantity || 1, total: l.total_row_amount || 0 });
          docTotals[dn] += (l.total_row_amount || 0);
        }
      }
      // Fetch existing statuses from LinetOrderStatus entity
      const existingStatuses = await base44.entities.LinetOrderStatus.list(null, 500);
      const statusMap = {};
      for (const s of existingStatuses) statusMap[s.doc_number] = s;

      // Build unified order objects
      for (const dn of orderDocNumbers) {
        const meta = docMeta[dn];
        const existing = statusMap[dn];
        const status = existing?.status || 'ממתינה לאספקה';
        // Auto-create status record if missing
        if (!existing) {
          base44.entities.LinetOrderStatus.create({
            doc_number: dn, linet_doc_id: meta.linet_doc_id,
            status: 'ממתינה לאספקה', customer_name: meta.customer_name, client_id: meta.client_id
          }).catch(() => {});
        }
        if (!showClosed && status === 'טופל') continue;
        const client = meta.client_id ? cM[meta.client_id] : null;
        lin.push({
          id: 'linet_' + dn, source: 'linet',
          order_number: dn, order_date: meta.issue_date || '',
          customer_name: meta.customer_name || '',
          customer_phone: client?.phone || '',
          customer_email: client?.email || '',
          products: docProducts[dn] || [],
          total: docTotals[dn] || 0, shipping_method: '',
          shipping_city: client?.city || '',
          shipping_street: client?.full_address || '',
          shipping_address_full: [client?.full_address, client?.city].filter(Boolean).join(', '),
          status, notes: existing?.notes || '',
          raw_id: existing?.id || '', linet_doc_id: meta.linet_doc_id || '',
          linet_doc_number: dn,
          invoice_created_at: meta.issue_date || '',
          client_id: meta.client_id || '',
          sales_rep: meta.sales_rep || '', currency: 'ILS',
          related_shipments: getRelatedShipments({ order_number: dn, external_order_number: dn, client_id: meta.client_id })
        });
      }
    } catch (e) { errs.push({source: 'linet', message: e.message}); }

    const all = [...woo, ...mk, ...lin];
    all.sort((a, b) => new Date(b.order_date || 0) - new Date(a.order_date || 0));
    setOrders(all);
    // Count only open orders for summary cards
    const openWooCount = woo.filter(o => openWoo.has(o.status)).length;
    const openMiraklCount = mk.filter(o => openMirakl.has(o.status)).length;
    const openLinetCount = lin.filter(o => o.status !== 'טופל').length;
    setCounts({woocommerce: openWooCount, mirakl: openMiraklCount, linet: openLinetCount, total: openWooCount + openMiraklCount + openLinetCount});
    setErrors(errs);
    setLastRefresh(new Date());
    setIsLoading(false);
    setIsRefreshing(false);
  }, [showClosed]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load active shipping providers
  useEffect(() => {
    const loadProviders = async () => {
      const map = { velo: false, cargo: false, getpackage: false };
      try {
        const providers = await base44.entities.ShippingProvider.list();
        for (const p of providers) {
          if (p.provider_type === 'velo' && p.is_active) map.velo = true;
          if (p.provider_type === 'cargo' && p.is_active) map.cargo = true;
        }
      } catch (_) {}
      try {
        const gpSettings = await base44.entities.GetPackageSettings.list('-created_date', 1);
        if (gpSettings?.[0]?.is_active) map.getpackage = true;
      } catch (_) {}
      setActiveProviders(map);
    };
    loadProviders();
  }, []);

  // Auto-refresh every 5 minutes during business hours
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay(); // 0=Sun
      let isBusinessHours = false;
      if (day >= 0 && day <= 4 && hour >= 9 && hour < 22) isBusinessHours = true; // Sun-Thu
      if (day === 5 && hour >= 9 && hour < 15) isBusinessHours = true; // Fri
      if (day === 6 && hour >= 17 && hour < 23) isBusinessHours = true; // Sat

      const intervalMs = isBusinessHours ? 5 * 60 * 1000 : 4 * 60 * 60 * 1000;
      // Only refresh if enough time passed
      if (lastRefresh && (new Date() - lastRefresh) >= intervalMs) {
        loadData(true);
      }
    }, 60 * 1000); // Check every minute

    return () => clearInterval(interval);
  }, [lastRefresh, loadData]);

  // Helper: is order pending/needs action
  const isPendingOrder = (o) => {
    if (o.source === 'woocommerce') return ['processing', 'on-hold', 'wc-awaiting-serial'].includes(o.status);
    if (o.source === 'mirakl') return ['WAITING_ACCEPTANCE', 'SHIPPING'].includes(o.status);
    if (o.source === 'linet') return o.status !== 'טופל';
    return false;
  };

  // Filtered + searched orders
  const filteredOrders = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    return orders.filter(o => {
      if (sourceFilter !== 'all' && o.source !== sourceFilter) return false;
      if (!showClosed && isClosedStatus(o.source, o.status)) return false;
      if (statusFilter === 'pending' && !isPendingOrder(o)) return false;
      if (!search) return true;
      return (
        o.order_number?.toLowerCase().includes(search) ||
        o.customer_name?.toLowerCase().includes(search) ||
        o.customer_phone?.includes(search) ||
        o.tracking_number?.toLowerCase().includes(search) ||
        o.products?.some(p => p.name?.toLowerCase().includes(search))
      );
    });
  }, [orders, searchTerm, sourceFilter, statusFilter, showClosed]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  const paginatedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);



  // Status change handler
  const handleStatusChange = async (order, newStatus) => {
    try {
      if (order.source === 'woocommerce') {
        await updateWooOrderStatus({ order_id: order.raw_id, new_status: newStatus });
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
      } else if (order.source === 'mirakl') {
        if (newStatus === 'accept_mirakl') {
          await updateSuperPharmOrder({ action: 'accept', order_id: order.mirakl_order_id });
          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'SHIPPING' } : o));
        } else {
          // For other Mirakl status changes
          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
        }
      } else if (order.source === 'linet') {
        // Update LinetOrderStatus entity
        if (order.raw_id) {
          await base44.entities.LinetOrderStatus.update(order.raw_id, { status: newStatus });
        } else {
          // Find or create
          const existing = await base44.entities.LinetOrderStatus.filter({ doc_number: order.order_number });
          if (existing.length > 0) {
            await base44.entities.LinetOrderStatus.update(existing[0].id, { status: newStatus });
          }
        }
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
      }
    } catch (err) {
      alert(`שגיאה בעדכון סטטוס: ${err.message}`);
    }
  };

  // Selection
  const handleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const handleSelectAll = () => {
    if (selectedIds.length === paginatedOrders.length) setSelectedIds([]);
    else setSelectedIds(paginatedOrders.map(o => o.id));
  };

  // Bulk SMS
  const handleBulkSms = async (message) => {
    const selected = orders.filter(o => selectedIds.includes(o.id) && o.customer_phone);
    if (!window.confirm(`שלח SMS ל-${selected.length} לקוחות?`)) return;
    let sent = 0, failed = 0;
    for (const o of selected) {
      try {
        await sendTextMeSMS({
          action: "send", to_phone: o.customer_phone, message,
          event_type: "bulk_order_sms", fingerprint: `bulk|${o.id}|${Date.now()}`
        });
        sent++;
      } catch { failed++; }
    }
    alert(`נשלחו ${sent} הודעות, ${failed} נכשלו`);
    setSelectedIds([]);
  };

  const resetFilters = () => {
    setSearchTerm("");
    setSourceFilter("all");
    setStatusFilter("all");
    setShowClosed(false);
    setPage(1);
  };

  const openShipmentSafely = (order) => {
    const reason = getShipmentBlockReason(order.source, order.status);
    if (reason) {
      alert(reason);
      return;
    }
    setShipmentOrder(order);
  };

  const openCargoShipmentSafely = (order) => {
    const reason = getShipmentBlockReason(order.source, order.status);
    if (reason) {
      alert(reason);
      return;
    }
    setCargoOrder(order);
  };

  const openGetPackageSafely = (order) => {
    const reason = getShipmentBlockReason(order.source, order.status);
    if (reason) {
      alert(reason);
      return;
    }
    setTimeout(() => {
      const el = document.querySelector('[data-getpackage-card]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  return (
    <div className="p-3 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg shadow-purple-200">
              <Package className="w-5 h-5 text-white" />
            </div>
            מסך הזמנות מרוכז
          </h1>
          <p className="text-gray-400 text-sm mt-1 mr-[52px]">
            {lastRefresh && <span>עדכון אחרון: {lastRefresh.toLocaleTimeString('he-IL')}</span>}
          </p>
        </div>
        <Button onClick={() => loadData(true)} disabled={isRefreshing} className="rounded-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white shadow-lg shadow-purple-200 px-5">
          <RefreshCw className={`w-4 h-4 ml-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          רענן עכשיו
        </Button>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-3">
            {errors.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-orange-800">
                <AlertTriangle className="w-4 h-4" />
                <span>מקור <strong>{e.source}</strong> לא זמין: {e.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <SummaryCards counts={counts} />

      {/* Filters */}
      <Card className="border-0 shadow-lg rounded-2xl bg-white/70 backdrop-blur-sm">
        <CardContent className="p-4">
          <OrderFilters
            searchTerm={searchTerm} setSearchTerm={setSearchTerm}
            sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            showClosed={showClosed} setShowClosed={setShowClosed}
            onReset={resetFilters}
          />
        </CardContent>
      </Card>

      {/* Products to prepare */}
      <PendingProductsSummary orders={orders} />

      {/* Bulk actions */}
      {canBulk && selectedIds.length > 0 && (
        <Card className="border-0 shadow-lg rounded-2xl bg-gradient-to-r from-purple-50 to-violet-50">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <Badge className="bg-gradient-to-r from-purple-500 to-violet-600 text-white rounded-full px-3">{selectedIds.length} נבחרו</Badge>
            <Button size="sm" variant="outline" className="h-8 text-xs rounded-full" onClick={() => {
              const msg = prompt("הקלד את ההודעה לשליחה מרוכזת:");
              if (msg) handleBulkSms(msg);
            }}>
              <MessageCircle className="w-3 h-3 ml-1" />SMS מרוכז
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds([])}>
              נקה בחירה
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="border-0 shadow-xl rounded-2xl overflow-hidden">
        <CardHeader className="pb-2 bg-gradient-to-l from-purple-50/30 to-transparent">
          <CardTitle className="text-base font-bold">הזמנות ({filteredOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-16">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-3" />
              <p className="text-gray-500 text-sm">טוען הזמנות מכל המקורות...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>לא נמצאו הזמנות</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="overflow-x-auto hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canBulk && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectedIds.length === paginatedOrders.length && paginatedOrders.length > 0}
                            onCheckedChange={handleSelectAll}
                          />
                        </TableHead>
                      )}
                      <TableHead></TableHead>
                      <TableHead>מקור</TableHead>
                      <TableHead>מס' הזמנה</TableHead>
                      <TableHead>תאריך</TableHead>
                      <TableHead>שם לקוח</TableHead>
                      <TableHead>מוצרים</TableHead>
                      <TableHead>סכום</TableHead>
                      <TableHead>סטטוס</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedOrders.map(order => (
                      <React.Fragment key={order.id}>
                        <UnifiedOrderRow
                          order={order}
                          isExpanded={expandedId === order.id}
                          onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
                          onSelect={handleSelect}
                          isSelected={selectedIds.includes(order.id)}
                          canBulk={canBulk}
                        />
                        {expandedId === order.id && (
                          <TableRow>
                            <TableCell colSpan={canBulk ? 10 : 9} className="p-0">
                              <OrderDetailPanel
                                order={order}
                                onSms={(o) => setSmsOrder(o)}
                                onStatusChange={handleStatusChange}
                                onShipment={(o) => openShipmentSafely(o)}
                                onCreateInvoice={(o) => setInvoiceOrder(o)}
                                onCargoShipment={(o) => openCargoShipmentSafely(o)}
                                onGetPackageShipment={(o) => openGetPackageSafely(o || order)}
                                activeProviders={activeProviders}
                                isManager={isManager}
                                isShiftManager={isShiftManager}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {paginatedOrders.map(order => (
                  <MobileOrderCard
                    key={order.id}
                    order={order}
                    isExpanded={expandedId === order.id}
                    onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
                    onSms={() => setSmsOrder(order)}
                    onStatusChange={handleStatusChange}
                    onShipment={(nextOrder) => openShipmentSafely(nextOrder || order)}
                    onCreateInvoice={() => setInvoiceOrder(order)}
                    onCargoShipment={(nextOrder) => openCargoShipmentSafely(nextOrder || order)}
                    onGetPackageShipment={(o) => openGetPackageSafely(o || order)}
                    activeProviders={activeProviders}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-3 pt-4">
                  <Button variant="outline" size="sm" className="rounded-full px-5" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>הקודם</Button>
                  <span className="text-sm text-gray-500 font-medium bg-gray-100 px-3 py-1 rounded-full">עמוד {page} מתוך {totalPages}</span>
                  <Button variant="outline" size="sm" className="rounded-full px-5" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>הבא</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Refresh indicator */}
      {isRefreshing && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-purple-500 to-violet-600 backdrop-blur shadow-xl shadow-purple-200 rounded-full px-5 py-2.5 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-white" />
          <span className="text-xs text-white font-medium">מרענן...</span>
        </div>
      )}

      {/* SMS Modal */}
      {smsOrder && (
        <SendSmsOrderModal
          open={!!smsOrder}
          onClose={() => setSmsOrder(null)}
          customerName={smsOrder.customer_name}
          customerPhone={smsOrder.customer_phone}
          orderNumber={smsOrder.order_number}
          orderSource={smsOrder.source}
        />
      )}

      {/* Mirakl Velo (home delivery) */}
      {shipmentOrder && shipmentOrder._shipCarrier === 'velo' && (
        <SPShipDialog
          order={{
            mirakl_order_id: shipmentOrder.mirakl_order_id || shipmentOrder.order_number,
            customer_first_name: shipmentOrder.customer_first_name || shipmentOrder.customer_name?.split(' ')[0] || '',
            customer_last_name: shipmentOrder.customer_last_name || shipmentOrder.customer_name?.split(' ').slice(1).join(' ') || '',
            customer_phone: shipmentOrder.customer_phone || '',
            shipping_city: shipmentOrder.shipping_city || '',
            shipping_street: shipmentOrder.shipping_street || '',
            shipping_zip: shipmentOrder.shipping_zip || '',
            order_lines_json: JSON.stringify(shipmentOrder.products?.map(p => ({ product_title: p.name, offer_sku: '', quantity: p.quantity, total_price: p.total, price: p.total })) || []),
            total_price: shipmentOrder.total || 0,
          }}
          open={true}
          onClose={() => { setShipmentOrder(null); }}
          onSuccess={async () => {
            setShipmentOrder(null);
            await loadData(true);
          }}
          onCreateInvoice={(o) => {
            setShipmentOrder(null);
            setInvoiceOrder(o);
          }}
        />
      )}

      {/* UPS (pickup point) - for Mirakl orders: show SP success screen after; for others: just close */}
      {shipmentOrder && shipmentOrder._shipCarrier === 'ups' && !upsSuccessData && (
        <CreateShipmentModal
          open={true}
          onClose={() => { setShipmentOrder(null); loadData(true); }}
          order={{
            raw_data_billing: JSON.stringify({
              first_name: shipmentOrder.customer_first_name || shipmentOrder.customer_name?.split(' ')[0] || '',
              last_name: shipmentOrder.customer_last_name || shipmentOrder.customer_name?.split(' ').slice(1).join(' ') || '',
              phone: shipmentOrder.customer_phone || '',
              city: shipmentOrder.shipping_city || '',
              address_1: shipmentOrder.shipping_street || '',
              postcode: shipmentOrder.shipping_zip || '',
            }),
            external_order_number: shipmentOrder.mirakl_order_id || shipmentOrder.order_number,
            shipping_method: 'איסוף מנקודת איסוף',
            pickup_point_data: shipmentOrder.pickup_point_data,
            id: shipmentOrder.source === 'woocommerce' ? shipmentOrder.raw_id : null,
            client_id: shipmentOrder.client_id || null,
          }}
          client={{
            full_name: shipmentOrder.customer_name,
            phone: shipmentOrder.customer_phone,
            city: shipmentOrder.shipping_city || '',
          }}
          initialType={shipmentOrder._upsShipmentType}
          onSuccess={({ tracking_number }) => {
            if (tracking_number && shipmentOrder.source === 'mirakl' && !shipmentOrder._upsShipmentType) {
              // Only show Mirakl update + Linet invoice screen for regular Mirakl shipments
              const spOrder = {
                mirakl_order_id: shipmentOrder.mirakl_order_id || shipmentOrder.order_number,
                customer_first_name: shipmentOrder.customer_first_name || shipmentOrder.customer_name?.split(' ')[0] || '',
                customer_last_name: shipmentOrder.customer_last_name || shipmentOrder.customer_name?.split(' ').slice(1).join(' ') || '',
                customer_phone: shipmentOrder.customer_phone || '',
                _shipCarrier: shipmentOrder._shipCarrier || 'ups',
                carrier_code: shipmentOrder.carrier_code || shipmentOrder.shipping_carrier_code || 'deliv_ups',
                carrier_name: shipmentOrder.carrier_name || shipmentOrder.shipping_company || 'UPS',
                raw_mirakl_json: shipmentOrder.raw_mirakl_json || '',
                order_lines_json: JSON.stringify(shipmentOrder.products?.map(p => ({ product_title: p.name, offer_sku: '', quantity: p.quantity, total_price: p.total, price: p.total })) || []),
                total_price: shipmentOrder.total || 0,
              };
              setUpsSuccessData({ trackingNumber: tracking_number, order: spOrder });
            } else {
              if (shipmentOrder._upsShipmentType) {
                setShipmentOrder(null);
                loadData(true);
              } else {
                // WooCommerce / Linet - show post-shipment confirmation dialog
                setPostShipmentData({ order: shipmentOrder, trackingNumber: tracking_number, carrierHint: 'ups' });
                setShipmentOrder(null);
              }
            }
          }}
        />
      )}

      {/* UPS Success Screen with Mirakl update + Linet invoice (Mirakl orders only) */}
      {upsSuccessData && (
        <SPShipmentSuccessScreen
          trackingNumber={upsSuccessData.trackingNumber}
          order={upsSuccessData.order}
          onDone={() => {
            setUpsSuccessData(null);
            setShipmentOrder(null);
            loadData(true);
          }}
        />
      )}

      {/* Non-carrier-flagged shipment (WooCommerce orders via OrderDetailPanel default) */}
      {shipmentOrder && !shipmentOrder._shipCarrier && (
        <CreateShipmentModal
          open={!!shipmentOrder}
          onClose={() => { setShipmentOrder(null); loadData(true); }}
          order={{
            id: shipmentOrder.raw_id,
            external_order_number: shipmentOrder.order_number,
            client_id: shipmentOrder.client_id,
            shipping_method: shipmentOrder.shipping_method,
            pickup_point_data: shipmentOrder.pickup_point_data,
          }}
          client={{
            full_name: shipmentOrder.customer_name,
            phone: shipmentOrder.customer_phone,
            city: shipmentOrder.shipping_city || '',
          }}
          initialType={shipmentOrder._upsShipmentType}
          onSuccess={({ tracking_number }) => {
            if (tracking_number && !shipmentOrder._upsShipmentType && (shipmentOrder.source === 'woocommerce' || shipmentOrder.source === 'mirakl')) {
              setPostShipmentData({ order: shipmentOrder, trackingNumber: tracking_number, carrierHint: 'ups' });
            } else if (shipmentOrder._upsShipmentType) {
              loadData(true);
            }
            setShipmentOrder(null);
          }}
        />
      )}

      {/* Cargo Shipment Modal */}
      {cargoOrder && (
        <CargoShipmentModal
          open={!!cargoOrder}
          onClose={(resultData) => {
            // Status update is now handled inside CargoShipmentModal itself
            loadData(true);
            setCargoOrder(null);
          }}
          order={cargoOrder}
          client={{ id: cargoOrder.client_id || '', full_name: cargoOrder.customer_name, phone: cargoOrder.customer_phone, city: cargoOrder.shipping_city || '', full_address: cargoOrder.shipping_street || cargoOrder.shipping_address_full || '' }}
          initialShipmentType={cargoOrder._cargoShipmentType || 'delivery'}
        />
      )}

      {/* Linet Invoice Modal for Mirakl orders */}
      {invoiceOrder && (
        <SPLinetInvoiceModal
          order={invoiceOrder}
          open={!!invoiceOrder}
          onClose={() => setInvoiceOrder(null)}
          onInvoiceCreated={() => loadData(true)}
        />
      )}

      {/* Post-Shipment Confirmation Dialog (WooCommerce/Linet status update) */}
      {postShipmentData && (
        <PostShipmentConfirmDialog
          open={!!postShipmentData}
          onClose={() => { setPostShipmentData(null); loadData(true); }}
          order={postShipmentData.order}
          trackingNumber={postShipmentData.trackingNumber}
          carrierHint={postShipmentData.carrierHint}
          onStatusUpdated={() => {
            loadData(true);
          }}
        />
      )}
    </div>
  );
}