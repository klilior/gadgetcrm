import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { BarChart3, ExternalLink } from "lucide-react";

const statusColors = {
  "🟢 תקין": "bg-green-100 text-green-800",
  "🟡 קרוב ליעד": "bg-yellow-100 text-yellow-800",
  "🔴 רחוק מהיעד": "bg-red-100 text-red-800",
  "⚠️ רווח נמוך": "bg-orange-100 text-orange-800",
};

export default function ZapPriceMonitorWidget() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const data = await base44.entities.ProductsMonitor.filter({ is_active: true }, '-last_check_time', 5);
      setProducts(data || []);
    } catch (e) {
      console.error("Error loading price monitor:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return null;
  if (products.length === 0) return null;

  return (
    <Card className="border-0 shadow-lg bg-white/80 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-purple-600" />
            ניטור מחירים - Zap
          </CardTitle>
          <Link to={createPageUrl("PriceMonitor")}>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
              <ExternalLink className="w-3 h-3" />
              לדף המלא
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {products.map(p => (
            <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{p.product_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500">
                    מיקום: <span className="font-bold text-gray-800">#{p.current_position || "—"}</span>
                  </span>
                  <span className="text-xs text-gray-400">|</span>
                  <span className="text-xs text-gray-500">
                    מחיר: <span className="font-bold text-gray-800">{p.my_current_price ? `₪${p.my_current_price.toLocaleString()}` : "—"}</span>
                  </span>
                </div>
              </div>
              <Badge className={`${statusColors[p.status_code] || "bg-gray-100 text-gray-700"} text-[10px] flex-shrink-0 mr-2`}>
                {p.status_code || "—"}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}