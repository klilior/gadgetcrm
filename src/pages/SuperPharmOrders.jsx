import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RefreshCw, ShoppingCart, Clock, Truck, CheckCircle } from "lucide-react";
import { syncSuperPharmOrders } from "@/functions/syncSuperPharmOrders";
import SPOrdersTable from "../components/superpharm/SPOrdersTable";
import SPOrderDetailsModal from "../components/superpharm/SPOrderDetailsModal";
import { toast } from "sonner";

const TABS = [
  { key: "WAITING_ACCEPTANCE", label: "ממתינות לאישור", icon: Clock, color: "text-orange-600" },
  { key: "SHIPPING", label: "ממתינות למשלוח", icon: Truck, color: "text-blue-600" },
  { key: "SHIPPED", label: "נשלחו", icon: CheckCircle, color: "text-green-600" },
  { key: "ALL", label: "הכל", icon: ShoppingCart, color: "text-gray-600" },
];

const AUTO_REFRESH_INTERVAL = 60000; // 60 seconds

export default function SuperPharmOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("WAITING_ACCEPTANCE");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const all = await base44.entities.SuperPharmOrder.list("-created_at_mirakl", 200);
      setOrders(all);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Error loading orders:", e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      loadOrders(true); // silent refresh
    }, AUTO_REFRESH_INTERVAL);
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

  const filteredOrders = activeTab === "ALL"
    ? orders
    : orders.filter(o => o.order_state === activeTab);

  const counts = {
    WAITING_ACCEPTANCE: orders.filter(o => o.order_state === "WAITING_ACCEPTANCE").length,
    SHIPPING: orders.filter(o => o.order_state === "SHIPPING").length,
    SHIPPED: orders.filter(o => o.order_state === "SHIPPED").length,
    ALL: orders.length,
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-green-600" />
            הזמנות סופר-פארם
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            ניהול הזמנות מרקטפלייס Mirakl
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

      {/* Tab Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const count = counts[tab.key];
          return (
            <Card
              key={tab.key}
              className={`cursor-pointer transition-all hover:shadow-md ${isActive ? "ring-2 ring-green-400 shadow-md" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500">{tab.label}</div>
                  <div className="text-2xl font-bold">{count}</div>
                </div>
                <Icon className={`w-8 h-8 ${tab.color} opacity-50`} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <SPOrdersTable orders={filteredOrders} onSelectOrder={setSelectedOrder} />
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