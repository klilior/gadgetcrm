import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Plus, Package, Bell, Lightbulb, Archive, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import SummaryCards from "../components/price-monitor/SummaryCards";
import ActiveProductsTable from "../components/price-monitor/ActiveProductsTable";
import AlertsFeed from "../components/price-monitor/AlertsFeed";
import AddProductModal from "../components/price-monitor/AddProductModal";
import RecommendationsTable from "../components/price-monitor/RecommendationsTable";
import ProductDetailModal from "../components/price-monitor/ProductDetailModal";
import ManualCheckModal from "../components/price-monitor/ManualCheckModal";
import EditProductModal from "../components/price-monitor/EditProductModal";
import SmsLogTable from "../components/sms/SmsLogTable";

export default function PriceMonitor() {
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [manualCheckProduct, setManualCheckProduct] = useState(null);
  const [refreshingId, setRefreshingId] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [tab, setTab] = useState("products");

  const [latestSnapshots, setLatestSnapshots] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [prods, alrts, recs, snaps] = await Promise.all([
      base44.entities.ProductsMonitor.list("-created_date", 200),
      base44.entities.PriceAlert.filter({ is_read: false }, "-alert_timestamp", 50),
      base44.entities.PriceRecommendation.filter({ status: "חדש" }, "-recommendation_time", 50),
      base44.entities.PriceSnapshot.list("-check_timestamp", 50),
    ]);
    setProducts(prods || []);
    setAlerts(alrts || []);
    setRecommendations(recs || []);
    // Keep only latest snapshot per product
    const snapMap = {};
    for (const s of (snaps || [])) {
      if (!snapMap[s.linked_product]) snapMap[s.linked_product] = s;
    }
    setLatestSnapshots(Object.values(snapMap));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const activeProducts = products.filter(p => p.is_active);

  const counts = {
    products: activeProducts.length,
    alerts: alerts.length,
    recommendations: recommendations.length,
    lastCheck: activeProducts
      .filter(p => p.last_check_time)
      .sort((a, b) => new Date(b.last_check_time) - new Date(a.last_check_time))[0]?.last_check_time || null,
  };

  const handleAddProduct = async (data) => {
    await base44.entities.ProductsMonitor.create(data);
    loadData();
  };

  const handleEditProduct = async (id, data) => {
    await base44.entities.ProductsMonitor.update(id, data);
    toast.success("המוצר עודכן בהצלחה");
    loadData();
  };

  const handleRemoveProduct = async (productOrId) => {
    const id = typeof productOrId === 'string' ? productOrId : productOrId.id;
    const product = products.find(p => p.id === id);
    if (typeof productOrId !== 'string' && !confirm(`האם להסיר את "${product?.product_name}" מהניטור?`)) return;
    await base44.entities.ProductsMonitor.delete(id);
    toast.success("המוצר הוסר מהניטור");
    loadData();
  };

  const handleRefreshProduct = async (product) => {
    setRefreshingId(product.id);
    try {
      const res = await base44.functions.invoke("scrapeAndCheck", {
        action: "refresh_single",
        product_id: product.id,
      });
      const data = res.data || res;
      if (data.success) {
        toast.success(data.message?.replace(/\n/g, " | ") || "הרענון הושלם");
      } else {
        toast.error(data.error || "שגיאה ברענון");
      }
      loadData();
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    toast.info("מתחיל בדיקת כל המוצרים... זה עשוי לקחת כמה דקות");
    try {
      const res = await base44.functions.invoke("scrapeAndCheck", {
        action: "refresh_all",
      });
      const data = res.data || res;
      if (data.success) {
        toast.success(data.message?.replace(/\n/g, " | ") || "הבדיקה הושלמה");
      } else {
        toast.error(data.error || "שגיאה בבדיקה");
      }
      loadData();
    } catch (e) {
      toast.error("שגיאה: " + e.message);
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleMarkAlertRead = async (alert) => {
    await base44.entities.PriceAlert.update(alert.id, { is_read: true });
    setAlerts(prev => prev.filter(a => a.id !== alert.id));
  };

  const handleMarkRecDone = async (rec) => {
    await base44.entities.PriceRecommendation.update(rec.id, { status: "בוצע" });
    setRecommendations(prev => prev.filter(r => r.id !== rec.id));
  };

  const handleIgnoreRec = async (rec) => {
    await base44.entities.PriceRecommendation.update(rec.id, { status: "התעלמות" });
    setRecommendations(prev => prev.filter(r => r.id !== rec.id));
  };

  return (
    <div dir="rtl" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ניטור מחירים - Zap</h1>
          <p className="text-sm text-gray-500 mt-0.5">מעקב אחר מחירי מתחרים והמלצות תמחור</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefreshAll} disabled={loading || refreshingAll}>
            {refreshingAll ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-1" />}
            {refreshingAll ? "בודק..." : "רענן כל המוצרים"}
          </Button>
          <Button onClick={() => setShowAddModal(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 ml-1" />
            הוסף מוצר חדש
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <SummaryCards counts={counts} />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="products" className="flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" />
            <span>מוצרים פעילים</span>
            {activeProducts.length > 0 && (
              <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 rounded-full">{activeProducts.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="alerts" className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            <span>התראות</span>
            {alerts.length > 0 && (
              <span className="bg-red-100 text-red-800 text-[10px] px-1.5 rounded-full">{alerts.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="recommendations" className="flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5" />
            <span>המלצות</span>
            {recommendations.length > 0 && (
              <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 rounded-full">{recommendations.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5" />
            <span>כל המוצרים</span>
          </TabsTrigger>
          <TabsTrigger value="sms" className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>SMS</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="bg-white rounded-xl border shadow-sm p-4 mt-3">
          <ActiveProductsTable
            products={activeProducts}
            onRefresh={handleRefreshProduct}
            onDetails={(p) => setDetailProduct(p)}
            onManualCheck={(p) => setManualCheckProduct(p)}
            onEdit={(p) => setEditProduct(p)}
            onRemove={handleRemoveProduct}
            refreshingId={refreshingId}
            latestSnapshots={latestSnapshots}
          />
        </TabsContent>

        <TabsContent value="alerts" className="bg-white rounded-xl border shadow-sm p-4 mt-3">
          <AlertsFeed alerts={alerts} onMarkRead={handleMarkAlertRead} products={products} />
        </TabsContent>

        <TabsContent value="recommendations" className="bg-white rounded-xl border shadow-sm p-4 mt-3">
          <RecommendationsTable
            recommendations={recommendations}
            products={products}
            onMarkDone={handleMarkRecDone}
            onIgnore={handleIgnoreRec}
          />
        </TabsContent>

        <TabsContent value="all" className="bg-white rounded-xl border shadow-sm p-4 mt-3">
          <ActiveProductsTable
            products={products}
            onRefresh={handleRefreshProduct}
            onDetails={(p) => setDetailProduct(p)}
            onManualCheck={(p) => setManualCheckProduct(p)}
            onEdit={(p) => setEditProduct(p)}
            onRemove={handleRemoveProduct}
            refreshingId={refreshingId}
            latestSnapshots={latestSnapshots}
          />
        </TabsContent>
        <TabsContent value="sms" className="mt-3">
          <SmsLogTable />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <AddProductModal open={showAddModal} onClose={() => setShowAddModal(false)} onSubmit={handleAddProduct} />
      <ProductDetailModal product={detailProduct} open={!!detailProduct} onClose={() => setDetailProduct(null)} />
      <ManualCheckModal
        product={manualCheckProduct}
        open={!!manualCheckProduct}
        onClose={() => setManualCheckProduct(null)}
        onComplete={loadData}
      />
      <EditProductModal
        product={editProduct}
        open={!!editProduct}
        onClose={() => setEditProduct(null)}
        onSave={handleEditProduct}
        onRemove={handleRemoveProduct}
      />
    </div>
  );
}