import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Package, ShoppingBag, Printer } from "lucide-react";
import { isOpenStatus } from "./OrderStatusConfig";

export default function PendingProductsSummary({ orders }) {
  const [isOpen, setIsOpen] = useState(false);

  const pendingOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.source === 'woocommerce') return ['processing', 'on-hold', 'ordered', 'wc-awaiting-serial'].includes(o.status);
      if (o.source === 'mirakl') return ['WAITING_ACCEPTANCE', 'SHIPPING'].includes(o.status);
      if (o.source === 'linet') return o.status !== 'טופל';
      return false;
    });
  }, [orders]);

  const aggregatedProducts = useMemo(() => {
    const map = {};
    for (const order of pendingOrders) {
      for (const p of (order.products || [])) {
        const baseName = (p.name || '').trim();
        if (!baseName) continue;

        // Extract variant info (color, accessories) from WooCommerce meta_data
        let variantParts = [];
        if (p.meta_data) {
          try {
            const meta = typeof p.meta_data === 'string' ? JSON.parse(p.meta_data) : p.meta_data;
            if (Array.isArray(meta)) {
              for (const m of meta) {
                const k = (m.display_key || m.key || '').toLowerCase();
                const v = (m.display_value || m.value || '').trim();
                // Skip internal keys and "none" values
                if (k.startsWith('_') || !v || v === 'ללא') continue;
                // Strip HTML from display_value
                const cleanVal = v.replace(/<[^>]+>/g, '').replace(/\(.*?\)/g, '').trim();
                if (cleanVal && cleanVal !== 'ללא') {
                  variantParts.push(`${m.display_key || m.key}: ${cleanVal}`);
                }
              }
            }
          } catch (_) {}
        }

        const suffix = variantParts.length > 0 ? ` (${variantParts.join(' | ')})` : '';
        const key = baseName + suffix;
        if (!map[key]) {
          map[key] = { name: baseName, variant: suffix, quantity: 0, orders: [] };
        }
        map[key].quantity += (p.quantity || 1);
        map[key].orders.push({
          order_number: order.order_number,
          source: order.source,
          quantity: p.quantity || 1,
        });
      }
    }
    return Object.values(map).sort((a, b) => b.quantity - a.quantity);
  }, [pendingOrders]);

  if (aggregatedProducts.length === 0) return null;

  const totalItems = aggregatedProducts.reduce((sum, p) => sum + p.quantity, 0);

  return (
    <Card className="border-0 shadow-lg rounded-2xl bg-gradient-to-br from-emerald-50/80 to-green-50/50 overflow-hidden">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-sm">
              <ShoppingBag className="w-4 h-4 text-white" />
            </div>
            מוצרים להכנה
            <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs">
              {totalItems} יח' • {aggregatedProducts.length} מוצרים • {pendingOrders.length} הזמנות
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            {isOpen && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs rounded-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={(e) => {
                  e.stopPropagation();
                  const printWindow = window.open('', '_blank', 'width=800,height=600');
                  if (!printWindow) return;
                  const rows = aggregatedProducts.map(p => 
                    `<tr><td style="padding:8px 12px;border-bottom:1px solid #ccc;text-align:right;font-size:14px;">${p.name}${p.variant ? ' <span style="color:#666;font-size:12px;">' + p.variant + '</span>' : ''}</td><td style="padding:8px 12px;border-bottom:1px solid #ccc;text-align:center;font-size:16px;font-weight:bold;">${p.quantity}</td></tr>`
                  ).join('');
                  const now = new Date().toLocaleString('he-IL');
                  printWindow.document.write(`<!DOCTYPE html><html dir="rtl"><head><title>מוצרים להכנה</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#000;}table{width:100%;border-collapse:collapse;margin-top:10px;}th{padding:10px 12px;border-bottom:2px solid #000;text-align:right;font-size:13px;font-weight:bold;}td{padding:8px 12px;}@media print{body{margin:10px;}}</style></head><body><h2 style="margin-bottom:4px;">📦 מוצרים להכנה</h2><p style="color:#666;font-size:12px;margin-top:0;">${now} • ${totalItems} יח' • ${aggregatedProducts.length} מוצרים • ${pendingOrders.length} הזמנות</p><table><thead><tr><th style="text-align:right;">מוצר</th><th style="text-align:center;width:80px;">כמות</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
                  printWindow.document.close();
                  printWindow.focus();
                  setTimeout(() => printWindow.print(), 300);
                }}
              >
                <Printer className="w-3.5 h-3.5 ml-1" />
                הדפסה
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-emerald-200/60">
                  <th className="text-right py-2 px-3 text-xs font-semibold text-emerald-700">מוצר</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-emerald-700 w-24">כמות</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-emerald-700 w-48">הזמנות</th>
                </tr>
              </thead>
              <tbody>
                {aggregatedProducts.map((product, idx) => (
                  <tr key={idx} className="border-b border-gray-100 last:border-0 hover:bg-white/60 transition-colors">
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <div>
                          <span className="text-gray-800 font-medium">{product.name}</span>
                          {product.variant && (
                            <span className="text-xs text-purple-600 mr-1">{product.variant}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <Badge className={`${product.quantity > 1 ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-gray-100 text-gray-700 border-gray-200'} font-bold text-sm px-3`}>
                        {product.quantity}
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex flex-wrap gap-1">
                        {product.orders.map((o, i) => {
                          const sourceEmoji = o.source === 'woocommerce' ? '🟣' : o.source === 'mirakl' ? '💊' : '📋';
                          return (
                            <span key={i} className="text-[10px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-600 whitespace-nowrap">
                              {sourceEmoji} #{o.order_number}{o.quantity > 1 ? ` ×${o.quantity}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}