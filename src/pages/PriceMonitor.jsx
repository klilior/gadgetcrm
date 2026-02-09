import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Plus, Package, Bell, Lightbulb, Archive } from "lucide-react";

import SummaryCards from "../components/price-monitor/SummaryCards";
import ActiveProductsTable from "../components/price-monitor/ActiveProductsTable";
import AlertsFeed from "../components/price-monitor/AlertsFeed";
import AddProductModal from "../components/price-monitor/AddProductModal";
import RecommendationsTable from "../components/price-monitor/RecommendationsTable";
import ProductDetailModal from "../components/price-monitor/ProductDetailModal";

export default function PriceMonitor() {
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [tab, setTab] = useState("products");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [prods, alrts, recs] = await Promise.all([
      base44.entities.ProductsMonitor.list("-created_date", 200),
      base44.entities.PriceAlert.filter({ is_read: false }, "-alert_timestamp", 50),
      base44.entities.PriceRecommendation.filter({ status: "חדש" }, "-recommendation_time", 50),
    ]);
    setProducts(prods || []);
    setAlerts(alrts || []);
    setRecommendations(recs || []);
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

  const handleRefreshProduct = (product) => {
    // Placeholder — automation will handle this later
    alert(`רענון מוצר "${product.product_name}" — יופעל בשלב הבא`);
  };

  const handleRefreshAll = () => {
    alert("רענון כל המוצרים — יופעל בשלב הבא");
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
          <Button variant="outline" onClick={handleRefreshAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-1 ${loading ? "animate-spin" : ""}`} />
            רענן כל המוצרים
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
        <TabsList className="grid w-full grid-cols-4">
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
        </TabsList>

        <TabsContent value="products" className="bg-white rounded-xl border shadow-sm p-4 mt-3">
          <ActiveProductsTable
            products={activeProducts}
            onRefresh={handleRefreshProduct}
            onDetails={(p) => setDetailProduct(p)}
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
          />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <AddProductModal open={showAddModal} onClose={() => setShowAddModal(false)} onSubmit={handleAddProduct} />
      <ProductDetailModal product={detailProduct} open={!!detailProduct} onClose={() => setDetailProduct(null)} />
    </div>
  );
}