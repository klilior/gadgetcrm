import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, RefreshCw, ShoppingCart, Clock, Truck, CheckCircle,
  Search, Package, Ban, AlertTriangle, DollarSign, ReceiptText,
  Eye, MapPin, Copy, XCircle
} from "lucide-react";
import { syncSuperPharmOrders } from "@/functions/syncSuperPharmOrders";
import SPOrderDetailsModal from "../components/superpharm/SPOrderDetailsModal";
import { toast } from "sonner";

const STATE_CONFIG = {
  WAITING_ACCEPTANCE: { label: "ממתין לאישור", color: "bg-orange-100 text-orange-800 border-orange-200", icon: "⏳", dotColor: "bg-orange-500" },
  WAITING_DEBIT: { label: "ממתין לחיוב", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "💳", dotColor: "bg-yellow-500" },
  WAITING_DEBIT_PAYMENT: { label: "ממתין לתשלום", color: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "💳", dotColor: "bg-yellow-500" },
  SHIPPING: { label: "ממתין למשלוח", color: "bg-blue-100 text-blue-800 border-blue-200", icon: "📦", dotColor: "bg-blue-500" },
  SHIPPED: { label: "נשלח", color: "bg-green-100 text-green-800 border-green-200", icon: "🚚", dotColor: "bg-green-500" },
  TO_COLLECT: { label: "לאיסוף", color: "bg-purple-100 text-purple-800 border-purple-200", icon: "🏪", dotColor: "bg-purple-500" },
  RECEIVED: { label: "התקבל", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: "✅", dotColor: "bg-emerald-500" },
  CLOSED: { label: "נסגר", color: "bg-gray-100 text-gray-800 border-gray-200", icon: "🔒", dotColor: "bg-gray-500" },
  REFUSED: { label: "נדחה", color: "bg-red-100 text-red-800 border-red-200", icon: "❌", dotColor: "bg-red-500" },
  CANCELED: { label: "בוטל", color: "bg-red-100 text-red-800 border-red-200", icon: "🚫", dotColor: "bg-red-500" },
};

const TABS = [
  { key: "WAITING_ACCEPTANCE", label: "ממתינות לאישור", icon: Clock, color: "orange" },
  { key: "SHIPPING", label: "ממתינות למשלוח", icon: Package, color: "blue" },
  { key: "SHIPPED", label: "נשלחו", icon: Truck, color: "green" },
  { key: "RECEIVED", label: "התקבלו", icon: CheckCircle, color: "emerald" },
  { key: "ALL", label: "הכל", icon: ShoppingCart, color: "gray" },
];

const TAB_COLORS = {
  orange: { active: "border-orange-500 bg-orange-50", badge: "bg-orange-500", text: "text-orange-700" },
  blue: { active: "border-blue-500 bg-blue-50", badge: "bg-blue-500", text: "text-blue-700" },
  green: { active: "border-green-500 bg-green-50", badge: "bg-green-500", text: "text-green-700" },
  emerald: { active: "border-emerald-500 bg-emerald-50", badge: "bg-emerald-500", text: "text-emerald-700" },
  gray: { active: "border-gray-500 bg-gray-50", badge: "bg-gray-500", text: "text-gray-700" },
};

function formatDate(dateStr) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("he-IL", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}

function isUrgent(order) {
  if (order.order_state === "WAITING_ACCEPTANCE" && order.acceptance_decision_date) {
    return (new Date(order.acceptance_decision_date) - new Date()) / 3600000 < 4;
  }
  if (order.order_state === "SHIPPING" && order.shipping_deadline) {
    return (new Date(order.shipping_deadline) - new Date()) / 3600000 < 12;
  }
  return false;
}

function timeLeft(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  if (diff < 0) return "עבר";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)} ימים`;
  return `${hours}:${String(mins).padStart(2, "0")} שעות`;
}

export default function SuperPharmOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("WAITING_ACCEPTANCE");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const all = await base44.entities.SuperPharmOrder.list("-created_at_mirakl", 500);
      setOrders(all);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Error loading orders:", e);
      if (!silent) toast.error("שגיאה בטעינת הזמנות");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  useEffect(() => {
    intervalRef.current = setInterval(() => loadOrders(true), 60000);
    return () => clearInterval(intervalRef.current);
  }, [loadOrders]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data } = await syncSuperPharmOrders({});
      if (data.success) {
        toast.success(data.message);
        await loadOrders();
      } else {
        toast.error(data.error || "שגיאה בסנכרון");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const counts = useMemo(() => {
    const c = { ALL: orders.length };
    for (const t of TABS) {
      if (t.key !== "ALL") c[t.key] = orders.filter(o => o.order_state === t.key).length;
    }
    return c;
  }, [orders]);

  const stats = useMemo(() => {
    const active = orders.filter(o => !["CLOSED", "CANCELED", "REFUSED"].includes(o.order_state));
    return {
      totalRevenue: active.reduce((s, o) => s + (o.total_price || 0), 0),
      totalCommission: active.reduce((s, o) => s + (o.total_commission || 0), 0),
      urgentCount: orders.filter(isUrgent).length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let result = activeTab === "ALL" ? orders : orders.filter(o => o.order_state === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(o =>
        o.mirakl_order_id?.toLowerCase().includes(q) ||
        `${o.customer_first_name} ${o.customer_last_name}`.toLowerCase().includes(q) ||
        o.customer_phone?.includes(q) ||
        o.shipping_city?.toLowerCase().includes(q) ||
        o.tracking_number?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [orders, activeTab, searchQuery]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-green-600" />
            הזמנות סופר-פארם (Mirakl)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {orders.length} הזמנות
            {lastRefresh && (
              <span className="mr-2 text-xs text-gray-400">
                • עודכן {lastRefresh.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} className="bg-green-600 hover:bg-green-700">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <RefreshCw className="w-4 h-4 ml-2" />}
          {syncing ? "מסנכרן..." : "סנכרן מ-Mirakl"}
        </Button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-3 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-500 opacity-60" />
            <div>
              <div className="text-xs text-gray-500">הכנסות פעילות</div>
              <div className="text-lg font-bold">₪{stats.totalRevenue.toLocaleString()}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-3 flex items-center gap-3">
            <ReceiptText className="w-8 h-8 text-amber-500 opacity-60" />
            <div>
              <div className="text-xs text-gray-500">עמלות מרקטפלייס</div>
              <div className="text-lg font-bold">₪{stats.totalCommission.toLocaleString()}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-3 flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-500 opacity-60" />
            <div>
              <div className="text-xs text-gray-500">ממתינות לטיפול</div>
              <div className="text-lg font-bold">{(counts.WAITING_ACCEPTANCE || 0) + (counts.SHIPPING || 0)}</div>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-l-4 ${stats.urgentCount > 0 ? "border-l-red-500" : "border-l-gray-300"}`}>
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className={`w-8 h-8 opacity-60 ${stats.urgentCount > 0 ? "text-red-500" : "text-gray-400"}`} />
            <div>
              <div className="text-xs text-gray-500">דחופות</div>
              <div className={`text-lg font-bold ${stats.urgentCount > 0 ? "text-red-600" : ""}`}>{stats.urgentCount}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          const count = counts[tab.key] || 0;
          const colors = TAB_COLORS[tab.color];
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap border-2
                ${isActive ? colors.active + " border-opacity-100 shadow-sm" : "bg-white border-transparent hover:bg-gray-50"}`}
            >
              <Icon className={`w-4 h-4 ${isActive ? colors.text : "text-gray-400"}`} />
              <span className={isActive ? colors.text : "text-gray-600"}>{tab.label}</span>
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full text-white min-w-[20px] text-center ${isActive ? colors.badge : "bg-gray-400"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="חפש לפי מזהה הזמנה, שם לקוח, טלפון, עיר או מספר מעקב..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pr-10"
        />
      </div>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-green-500" />
              <span className="text-sm text-gray-500">טוען הזמנות...</span>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingCart className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">
                {searchQuery ? "לא נמצאו תוצאות לחיפוש" : "אין הזמנות בטאב זה"}
              </p>
              {searchQuery && (
                <Button variant="link" onClick={() => setSearchQuery("")} className="mt-1 text-sm">
                  נקה חיפוש
                </Button>
              )}
            </div>
          ) : (
            <OrdersTable orders={filteredOrders} onSelect={setSelectedOrder} />
          )}
        </CardContent>
      </Card>

      {/* Details Modal */}
      {selectedOrder && (
        <SPOrderDetailsModal
          order={selectedOrder}
          open={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onRefresh={async () => {
            await loadOrders();
            setSelectedOrder(null);
          }}
        />
      )}
    </div>
  );
}

function OrdersTable({ orders, onSelect }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50/80">
            <th className="text-right p-3 font-medium text-gray-600">הזמנה</th>
            <th className="text-right p-3 font-medium text-gray-600">לקוח</th>
            <th className="text-right p-3 font-medium text-gray-600">סטטוס</th>
            <th className="text-right p-3 font-medium text-gray-600 hidden sm:table-cell">פריטים</th>
            <th className="text-right p-3 font-medium text-gray-600">סכום</th>
            <th className="text-right p-3 font-medium text-gray-600 hidden md:table-cell">תאריך</th>
            <th className="text-right p-3 font-medium text-gray-600 hidden lg:table-cell">דד-ליין / מעקב</th>
            <th className="text-center p-3 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => {
            const state = STATE_CONFIG[order.order_state] || { label: order.order_state, color: "bg-gray-100 text-gray-800", icon: "❓", dotColor: "bg-gray-400" };
            const urgent = isUrgent(order);
            const deadline = order.order_state === "WAITING_ACCEPTANCE" ? order.acceptance_decision_date : order.shipping_deadline;
            const remaining = timeLeft(deadline);

            return (
              <tr
                key={order.id}
                className={`border-b cursor-pointer transition-colors hover:bg-gray-50
                  ${urgent ? "bg-red-50/60 hover:bg-red-50" : ""}`}
                onClick={() => onSelect(order)}
              >
                <td className="p-3">
                  <div className="flex items-center gap-1.5">
                    {urgent && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                    <span className="font-mono text-xs font-medium">{order.mirakl_order_id}</span>
                  </div>
                </td>
                <td className="p-3">
                  <div className="font-medium text-sm">{order.customer_first_name} {order.customer_last_name}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {order.shipping_city || "-"}
                  </div>
                </td>
                <td className="p-3">
                  <Badge variant="outline" className={`text-xs ${state.color}`}>
                    {state.icon} {state.label}
                  </Badge>
                </td>
                <td className="p-3 text-center hidden sm:table-cell">
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{order.order_lines_count || 0}</span>
                </td>
                <td className="p-3">
                  <span className="font-semibold">₪{(order.total_price || 0).toLocaleString()}</span>
                  {order.total_commission > 0 && (
                    <div className="text-[10px] text-gray-400">עמלה: ₪{order.total_commission}</div>
                  )}
                </td>
                <td className="p-3 text-xs text-gray-500 hidden md:table-cell">
                  {formatDate(order.created_at_mirakl)}
                </td>
                <td className="p-3 hidden lg:table-cell">
                  {order.tracking_number ? (
                    <div className="flex items-center gap-1 text-xs">
                      <Truck className="w-3 h-3 text-green-600" />
                      <span className="font-mono text-green-700">{order.tracking_number}</span>
                    </div>
                  ) : deadline ? (
                    <div className={`flex items-center gap-1 text-xs ${urgent ? "text-red-600 font-bold" : "text-gray-500"}`}>
                      <Clock className="w-3 h-3" />
                      {remaining}
                    </div>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); onSelect(order); }}>
                    <Eye className="w-4 h-4 text-gray-400" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}