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
import SendSmsOrderModal from "../components/unified-orders/SendSmsOrderModal";
import { isClosedStatus, LINET_ORDER_SKUS } from "../components/unified-orders/OrderStatusConfig";
import CreateShipmentModal from "../components/shipping/CreateShipmentModal";
import MobileOrderCard from "../components/unified-orders/MobileOrderCard";
import OrderDetailPanel from "../components/unified-orders/OrderDetailPanel";

const PAGE_SIZE = 50;

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
  const [showClosed, setShowClosed] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState([]);

  // Modals
  const [smsOrder, setSmsOrder] = useState(null);
  const [shipmentOrder, setShipmentOrder] = useState(null);

  // Expanded row
  const [expandedId, setExpandedId] = useState(null);

  // Pagination
  const [page, setPage] = useState(1);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    const errs = [];
    const closedWoo = new Set(['completed','cancelled','refunded','failed']);
    const closedMirakl = new Set(['CLOSED','REFUSED','CANCELED','RECEIVED']);

    // Shared client map (used by WooCommerce and Linet)
    let cM = {};
    try {
      const rawClients = await base44.entities.Client.list(null, 1000);
      for (const c of rawClients) cM[c.id] = c;
    } catch (e) { /* clients will be empty */ }

    // WooCommerce
    let woo = [];
    try {
      const [rawOrders, rawProducts] = await Promise.all([
        base44.entities.Order.list('-order_date', 200),
        base44.entities.OrderProduct.list(null, 2000)
      ]);
      const pM = {};
      for (const p of rawProducts) { if (!pM[p.order_id]) pM[p.order_id] = []; pM[p.order_id].push(p); }
      for (const o of rawOrders) {
        if (!showClosed && closedWoo.has(o.status)) continue;
        const c = cM[o.client_id];
        const pr = pM[o.id] || [];
        woo.push({
          id: 'woo_' + o.id, source: 'woocommerce',
          order_number: o.external_order_number || '', order_date: o.order_date || '',
          customer_name: c?.full_name || '', customer_phone: c?.phone || '',
          products: pr.map(x => ({name: x.name||'', quantity: x.quantity||1, total: parseFloat(x.total)||0})),
          total: parseFloat(o.total) || 0, shipping_method: o.shipping_method || '',
          status: o.status || '', notes: o.customer_note || '',
          raw_id: o.id, client_id: o.client_id || '', pickup_point_data: o.pickup_point_data, currency: 'ILS'
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
        mk.push({
          id: 'mirakl_' + o.id, source: 'mirakl',
          order_number: o.mirakl_order_id || '', order_date: o.created_at_mirakl || o.created_date || '',
          customer_name: ((o.customer_first_name||'') + ' ' + (o.customer_last_name||'')).trim(),
          customer_phone: o.customer_phone || '',
          products: lines.map(l => ({name: l.product_title||l.offer_sku||'', quantity: l.quantity||1, total: l.price||0})),
          total: o.total_price || 0, shipping_method: 'superpharm', shipping_city: o.shipping_city || '',
          status: o.order_state || '', notes: o.notes || '',
          raw_id: o.id, mirakl_order_id: o.mirakl_order_id || '',
          tracking_number: o.tracking_number || '', currency: o.currency || 'ILS'
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
      // Get unique doc_numbers from order-marker transactions (only invoices, not credits)
      const orderDocNumbers = new Set();
      const docMeta = {};
      for (const t of allTxns) {
        if (t.doc_type === 'חשבונית זיכוי') continue; // skip credit notes
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
          products: docProducts[dn] || [],
          total: docTotals[dn] || 0, shipping_method: '', shipping_city: '',
          status, notes: existing?.notes || '',
          raw_id: existing?.id || '', linet_doc_id: meta.linet_doc_id || '',
          sales_rep: meta.sales_rep || '', currency: 'ILS'
        });
      }
    } catch (e) { errs.push({source: 'linet', message: e.message}); }

    const all = [...woo, ...mk, ...lin];
    all.sort((a, b) => new Date(b.order_date || 0) - new Date(a.order_date || 0));
    setOrders(all);
    setCounts({woocommerce: woo.length, mirakl: mk.length, linet: lin.length, total: all.length});
    setErrors(errs);
    setLastRefresh(new Date());
    setIsLoading(false);
    setIsRefreshing(false);
  }, [showClosed]);

  useEffect(() => { loadData(); }, [loadData]);

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

  // Filtered + searched orders
  const filteredOrders = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    return orders.filter(o => {
      if (sourceFilter !== 'all' && o.source !== sourceFilter) return false;
      if (!showClosed && isClosedStatus(o.source, o.status)) return false;
      if (!search) return true;
      return (
        o.order_number?.toLowerCase().includes(search) ||
        o.customer_name?.toLowerCase().includes(search) ||
        o.customer_phone?.includes(search) ||
        o.products?.some(p => p.name?.toLowerCase().includes(search))
      );
    });
  }, [orders, searchTerm, sourceFilter, showClosed]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  const paginatedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Total value of open orders
  const totalValue = useMemo(() => {
    return orders.filter(o => !isClosedStatus(o.source, o.status))
      .reduce((sum, o) => sum + (o.total || 0), 0);
  }, [orders]);

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
    setShowClosed(false);
    setPage(1);
  };

  return (
    <div className="p-3 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-7 h-7 text-indigo-600" />
            מסך הזמנות מרוכז
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {lastRefresh && <span>עדכון אחרון: {lastRefresh.toLocaleTimeString('he-IL')}</span>}
          </p>
        </div>
        <Button onClick={() => loadData(true)} disabled={isRefreshing} variant="outline" size="sm">
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
      <SummaryCards counts={counts} totalValue={totalValue} />

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3">
          <OrderFilters
            searchTerm={searchTerm} setSearchTerm={setSearchTerm}
            sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
            showClosed={showClosed} setShowClosed={setShowClosed}
            onReset={resetFilters}
          />
        </CardContent>
      </Card>

      {/* Bulk actions */}
      {canBulk && selectedIds.length > 0 && (
        <Card className="border-0 shadow-sm bg-indigo-50">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <Badge className="bg-indigo-600 text-white">{selectedIds.length} נבחרו</Badge>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
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
      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">הזמנות ({filteredOrders.length})</CardTitle>
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
                                onShipment={(o) => setShipmentOrder(o)}
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
                    onShipment={() => setShipmentOrder(order)}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 pt-4">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>הקודם</Button>
                  <span className="text-sm text-gray-600">עמוד {page} מתוך {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>הבא</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Refresh indicator */}
      {isRefreshing && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 bg-white/90 backdrop-blur shadow-lg rounded-full px-4 py-2 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
          <span className="text-xs text-gray-600">מרענן...</span>
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

      {/* Shipment Modal */}
      {shipmentOrder && (
        <CreateShipmentModal
          isOpen={!!shipmentOrder}
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
        />
      )}
    </div>
  );
}