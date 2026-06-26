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
  return (
    <div dir="rtl" className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border shadow-sm p-8 max-w-lg text-center space-y-3">
        <h1 className="text-2xl font-bold text-gray-900">ניטור מחירים Zap מוקפא</h1>
        <p className="text-gray-600">התכונה הוסרה זמנית מהמערכת ותיבנה מחדש בהמשך.</p>
      </div>
    </div>
  );
}