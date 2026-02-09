import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";

function DeltaCell({ value, suffix = "" }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  if (value === 0) return <span className="text-gray-400">0</span>;
  const isPositive = value > 0;
  return (
    <span className={`font-medium ${isPositive ? "text-red-600" : "text-green-600"}`}>
      {isPositive ? "+" : ""}{value}{suffix}
    </span>
  );
}

export default function ProductDetailModal({ product, open, onClose }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!product || !open) return;
    setLoading(true);
    base44.entities.PriceSnapshot.filter({ linked_product: product.id }, "-check_timestamp", 10)
      .then(setSnapshots)
      .finally(() => setLoading(false));
  }, [product, open]);

  if (!product) return null;

  const latestSnap = snapshots[0];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>📊 {product.product_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product Info */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">מחיר עלות</span>
              <div className="font-bold">₪{product.cost_price?.toLocaleString() || "—"}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">מחיר נוכחי</span>
              <div className="font-bold">₪{product.my_current_price?.toLocaleString() || "—"}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">מיקום רצוי</span>
              <div className="font-bold">{product.desired_position ?? "—"}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">רווח מינימלי</span>
              <div className="font-bold">{product.min_profit_margin ?? 15}%</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">סטטוס</span>
              <div className="font-bold">{product.status_code || "—"}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <span className="text-gray-500 text-xs">בדיקה מוצלחת אחרונה</span>
              <div className="font-bold text-xs">
                {product.last_success_time ? format(new Date(product.last_success_time), "dd/MM/yy HH:mm") : (product.last_check_time ? format(new Date(product.last_check_time), "dd/MM/yy HH:mm") : "טרם")}
              </div>
            </div>
          </div>

          {/* Deltas since last check */}
          {latestSnap && latestSnap.prev_snapshot && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h3 className="font-semibold text-sm mb-2 text-blue-800">🔄 שינוי מאז בדיקה קודמת</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="text-center">
                  <div className="text-gray-500">Δ מיקום</div>
                  <DeltaCell value={latestSnap.position_delta} />
                </div>
                <div className="text-center">
                  <div className="text-gray-500">Δ מחיר באתר</div>
                  <DeltaCell value={latestSnap.price_site_delta} suffix="₪" />
                </div>
                <div className="text-center">
                  <div className="text-gray-500">Δ מחיר בזאפ</div>
                  <DeltaCell value={latestSnap.price_zap_delta} suffix="₪" />
                </div>
                <div className="text-center">
                  <div className="text-gray-500">Δ מתחרה מעל</div>
                  <DeltaCell value={latestSnap.above_price_delta} suffix="₪" />
                </div>
                <div className="text-center">
                  <div className="text-gray-500">Δ מתחרה מתחת</div>
                  <DeltaCell value={latestSnap.below_price_delta} suffix="₪" />
                </div>
              </div>
            </div>
          )}

          {/* Error info */}
          {product.last_error && (
            <div className="text-sm bg-red-50 p-3 rounded-lg border border-red-200">
              <span className="font-medium text-red-700">שגיאה אחרונה: </span>
              <span className="text-red-600">{product.last_error}</span>
              {product.consecutive_failures > 0 && (
                <Badge className="bg-red-100 text-red-800 text-[10px] mr-2">{product.consecutive_failures} כישלונות רצופים</Badge>
              )}
            </div>
          )}

          {/* Links */}
          <div className="flex gap-3 flex-wrap text-xs">
            {product.zap_comparison_url && (
              <a href={product.zap_comparison_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">🔗 Zap השוואה</a>
            )}
            {product.my_woocommerce_url && (
              <a href={product.my_woocommerce_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">🛒 WooCommerce</a>
            )}
          </div>

          {/* Snapshots History */}
          <div>
            <h3 className="font-semibold mb-2 text-sm">היסטוריית בדיקות (10 אחרונות)</h3>
            {loading ? (
              <div className="text-center py-4 text-gray-400 text-sm">טוען...</div>
            ) : snapshots.length === 0 ? (
              <div className="text-center py-4 text-gray-400 text-sm">אין בדיקות עדיין</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="p-2 text-right">זמן</th>
                      <th className="p-2 text-center">מיקום</th>
                      <th className="p-2 text-center">Δ</th>
                      <th className="p-2 text-center">מחיר שלנו</th>
                      <th className="p-2 text-center">מקום 1</th>
                      <th className="p-2 text-center">תוספת %</th>
                      <th className="p-2 text-center">רווח %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map(s => (
                      <tr key={s.id} className="border-b">
                        <td className="p-2 text-gray-600">
                          {s.check_timestamp ? format(new Date(s.check_timestamp), "dd/MM HH:mm") : "—"}
                        </td>
                        <td className="p-2 text-center font-medium">{s.my_position ?? "—"}</td>
                        <td className="p-2 text-center">
                          <DeltaCell value={s.position_delta} />
                        </td>
                        <td className="p-2 text-center">₪{s.my_price_on_site?.toLocaleString() || "—"}</td>
                        <td className="p-2 text-center">₪{s.first_place_price?.toLocaleString() || "—"}</td>
                        <td className="p-2 text-center">{s.markup_percent != null ? `${s.markup_percent.toFixed(1)}%` : "—"}</td>
                        <td className="p-2 text-center">{s.gross_margin_percent != null ? `${s.gross_margin_percent.toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {product.notes && (
            <div className="text-sm bg-yellow-50 p-3 rounded-lg border border-yellow-200">
              <span className="font-medium">הערות: </span>{product.notes}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}