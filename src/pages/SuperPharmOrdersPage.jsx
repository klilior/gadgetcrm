import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2, RefreshCw, ShoppingCart, Clock, CheckCircle,
  Search, Package, AlertTriangle, DollarSign, ReceiptText
} from "lucide-react";
import { syncSuperPharmOrders } from "@/functions/syncSuperPharmOrders";
import { updateSuperPharmOrder } from "@/functions/updateSuperPharmOrder";
import SPOrderCard from "../components/superpharm/SPOrderCard";
import SPShipDialog from "../components/superpharm/SPShipDialog";
import SPLinetInvoiceModal from "../components/superpharm/SPLinetInvoiceModal";
import CreateShipmentModal from "../components/shipping/CreateShipmentModal";
import { toast } from "sonner";



const TABS = [
  { key: "WAITING_ACCEPTANCE", label: "⏳ ממתינות לאישור", icon: Clock, color: "orange" },
  { key: "SHIPPING", label: "📦 ממתינות למשלוח", icon: Package, color: "blue" },
  { key: "SHIPPED_CLOSED", label: "✅ נשלחו", icon: CheckCircle, color: "green" },
  { key: "ALL", label: "הכל", icon: ShoppingCart, color: "gray" },
];

const TAB_COLORS = {
  orange: { active: "border-orange-500 bg-orange-50", badge: "bg-orange-500", text: "text-orange-700" },
  blue: { active: "border-blue-500 bg-blue-50", badge: "bg-blue-500", text: "text-blue-700" },
  green: { active: "border-green-500 bg-green-50", badge: "bg-green-500", text: "text-green-700" },
  gray: { active: "border-gray-500 bg-gray-50", badge: "bg-gray-500", text: "text-gray-700" },
};

function isUrgent(order) {
  if (order.order_state === "WAITING_ACCEPTANCE" && order.acceptance_decision_date) {
    return (new Date(order.acceptance_decision_date) - new Date()) / 3600000 < 4;
  }
  if (order.order_state === "SHIPPING" && order.shipping_deadline) {
    return (new Date(order.shipping_deadline) - new Date()) / 3600000 < 12;
  }
  return false;
}

export default function SuperPharmOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("WAITING_ACCEPTANCE");
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);
  const [shipOrder, setShipOrder] = useState(null);
  const [shipCarrier, setShipCarrier] = useState(null);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);
  const [upsPickupOrder, setUpsPickupOrder] = useState(null);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const all = await base44.entities.SuperPharmOrder.list("-created_at_mirakl", 50);
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

  const handleAccept = async (order) => {
    setAcceptingId(order.mirakl_order_id);
    try {
      const { data } = await updateSuperPharmOrder({ action: "accept", order_id: order.mirakl_order_id });
      if (data.success) {
        toast.success(data.message || "ההזמנה אושרה");
        await loadOrders();
      } else {
        toast.error(data.error || "שגיאה");
      }
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setAcceptingId(null);
    }
  };

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

  const counts = useMemo(() => ({
    ALL: orders.length,
    WAITING_ACCEPTANCE: orders.filter(o => o.order_state === "WAITING_ACCEPTANCE").length,
    SHIPPING: orders.filter(o => o.order_state === "SHIPPING").length,
    SHIPPED_CLOSED: orders.filter(o => ["SHIPPED", "CLOSED"].includes(o.order_state)).length,
  }), [orders]);

  const stats = useMemo(() => {
    const active = orders.filter(o => !["CLOSED", "CANCELED", "REFUSED"].includes(o.order_state));
    return {
      totalRevenue: active.reduce((s, o) => s + (o.total_price || 0), 0),
      totalCommission: active.reduce((s, o) => s + (o.total_commission || 0), 0),
      urgentCount: orders.filter(isUrgent).length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let result;
    if (activeTab === "ALL") {
      result = orders;
    } else if (activeTab === "SHIPPED_CLOSED") {
      result = orders.filter(o => ["SHIPPED", "CLOSED"].includes(o.order_state));
    } else {
      result = orders.filter(o => o.order_state === activeTab);
    }
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

      {/* Orders Cards */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredOrders.map(order => (
            <SPOrderCard
              key={order.id}
              order={order}
              onAccept={handleAccept}
              onShip={(o, carrier) => { setShipOrder(o); setShipCarrier(carrier); }}
              onCreateInvoice={(o) => setInvoiceOrder(o)}
            />
          ))}
        </div>
      )}

      {/* Ship Dialog (Velo - for non-pickup orders) */}
      {shipOrder && shipCarrier !== "ups" && (
        <SPShipDialog
          order={shipOrder}
          open={!!shipOrder}
          onClose={() => { setShipOrder(null); setShipCarrier(null); }}
          onSuccess={async () => {
            setShipOrder(null);
            setShipCarrier(null);
            await loadOrders();
          }}
          onCreateInvoice={(o) => {
            setShipOrder(null);
            setShipCarrier(null);
            setInvoiceOrder(o);
          }}
        />
      )}

      {/* UPS Pickup Point Shipment Modal */}
      {shipOrder && shipCarrier === "ups" && (
        <CreateShipmentModal
          open={true}
          onClose={() => { setShipOrder(null); setShipCarrier(null); }}
          order={{
            raw_data_billing: JSON.stringify({
              first_name: shipOrder.customer_first_name,
              last_name: shipOrder.customer_last_name,
              phone: shipOrder.customer_phone,
              city: shipOrder.shipping_city,
              address_1: shipOrder.shipping_street,
              postcode: shipOrder.shipping_zip,
            }),
            external_order_number: shipOrder.mirakl_order_id,
            shipping_method: "איסוף מנקודת איסוף",
            id: null,
            client_id: null,
          }}
          client={{
            full_name: `${shipOrder.customer_first_name} ${shipOrder.customer_last_name}`.trim(),
            phone: shipOrder.customer_phone,
            city: shipOrder.shipping_city,
          }}
          onSuccess={async ({ tracking_number }) => {
            if (tracking_number) {
              try {
                await updateSuperPharmOrder({
                  action: "ship",
                  order_id: shipOrder.mirakl_order_id,
                  tracking_number,
                  carrier_name: "UPS Israel",
                });
                toast.success("ההזמנה עודכנה ב-Mirakl עם מספר מעקב: " + tracking_number);
              } catch (e) {
                toast.error("שטר מטען נוצר אבל לא הצלחנו לעדכן ב-Mirakl: " + e.message);
              }
            }
            setShipOrder(null);
            setShipCarrier(null);
            await loadOrders();
          }}
        />
      )}

      {/* Linet Invoice Modal */}
      {invoiceOrder && (
        <SPLinetInvoiceModal
          order={invoiceOrder}
          open={!!invoiceOrder}
          onClose={() => setInvoiceOrder(null)}
        />
      )}
    </div>
  );
}