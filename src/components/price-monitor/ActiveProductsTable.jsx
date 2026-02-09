import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, BarChart3, FlaskConical, Loader2, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";

const statusColors = {
  "🟢 תקין": "bg-green-100 text-green-800 border-green-200",
  "🟡 קרוב ליעד": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "🔴 רחוק מהיעד": "bg-red-100 text-red-800 border-red-200",
  "⚠️ רווח נמוך": "bg-orange-100 text-orange-800 border-orange-200",
};

function DeltaBadge({ value, suffix = "" }) {
  if (value == null || value === 0) return null;
  const isPositive = value > 0;
  return (
    <span className={`text-[10px] font-medium ${isPositive ? "text-red-600" : "text-green-600"}`}>
      {isPositive ? "+" : ""}{value}{suffix}
    </span>
  );
}

export default function ActiveProductsTable({ products, onRefresh, onDetails, onManualCheck, onEdit, onRemove, refreshingId, latestSnapshots }) {
  if (!products || products.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-lg">אין מוצרים פעילים עדיין</p>
        <p className="text-sm mt-1">הוסף מוצר חדש כדי להתחיל במעקב</p>
      </div>
    );
  }

  const snapshotMap = {};
  if (latestSnapshots) {
    for (const s of latestSnapshots) {
      snapshotMap[s.linked_product] = s;
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50/80">
            <th className="p-3 text-right font-medium text-gray-600">שם מוצר</th>
            <th className="p-3 text-center font-medium text-gray-600">מחיר באתר</th>
            <th className="p-3 text-center font-medium text-gray-600">מיקום</th>
            <th className="p-3 text-center font-medium text-gray-600">יעד</th>
            <th className="p-3 text-center font-medium text-gray-600 hidden md:table-cell">מעליי</th>
            <th className="p-3 text-center font-medium text-gray-600 hidden md:table-cell">מתחתיי</th>
            <th className="p-3 text-center font-medium text-gray-600">סטטוס</th>
            <th className="p-3 text-right font-medium text-gray-600 hidden lg:table-cell">המלצה</th>
            <th className="p-3 text-center font-medium text-gray-600">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => {
            const isRefreshing = refreshingId === p.id;
            const snap = snapshotMap[p.id];
            const failures = p.consecutive_failures || 0;
            return (
              <tr key={p.id} className={`border-b hover:bg-gray-50/50 transition-colors ${isRefreshing ? "opacity-60" : ""}`}>
                <td className="p-3 font-medium text-gray-900">
                  <div className="flex items-center gap-1.5">
                    {failures >= 1 && (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title={`${failures} כישלונות רצופים`} />
                    )}
                    <span>{p.product_name}</span>
                    {p.needs_attention && <span className="text-red-500 text-xs">⚠</span>}
                  </div>
                </td>
                <td className="p-3 text-center">
                  <div>{p.my_current_price ? `₪${p.my_current_price.toLocaleString()}` : "—"}</div>
                  {snap?.price_site_delta != null && snap.price_site_delta !== 0 && (
                    <DeltaBadge value={snap.price_site_delta} suffix="₪" />
                  )}
                </td>
                <td className="p-3 text-center">
                  <div className="font-bold">{p.current_position ? `#${p.current_position}` : "—"}</div>
                  {snap?.position_delta != null && snap.position_delta !== 0 && (
                    <DeltaBadge value={snap.position_delta} />
                  )}
                </td>
                <td className="p-3 text-center text-gray-500">{p.desired_position ?? "—"}</td>
                <td className="p-3 text-center text-gray-500 text-xs hidden md:table-cell">
                  {snap?.position_above_me_price ? (
                    <div>
                      <div>₪{snap.position_above_me_price.toLocaleString()}</div>
                      {snap.position_above_me_store && <div className="text-[10px] text-gray-400 truncate max-w-[80px]">{snap.position_above_me_store}</div>}
                    </div>
                  ) : "—"}
                </td>
                <td className="p-3 text-center text-gray-500 text-xs hidden md:table-cell">
                  {snap?.position_below_me_price ? (
                    <div>
                      <div>₪{snap.position_below_me_price.toLocaleString()}</div>
                      {snap.position_below_me_store && <div className="text-[10px] text-gray-400 truncate max-w-[80px]">{snap.position_below_me_store}</div>}
                    </div>
                  ) : "—"}
                </td>
                <td className="p-3 text-center">
                  <Badge className={`${statusColors[p.status_code] || "bg-gray-100 text-gray-700"} text-xs`}>
                    {p.status_code || "—"}
                  </Badge>
                </td>
                <td className="p-3 text-right text-xs text-gray-500 hidden lg:table-cell max-w-[200px] truncate">
                  {p.last_recommendation_short || "—"}
                </td>
                <td className="p-3 text-center">
                  <div className="flex gap-1 justify-center">
                    {onEdit && (
                      <Button size="sm" variant="ghost" onClick={() => onEdit(p)} title="עריכה" className="text-blue-600 hover:text-blue-700">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {onManualCheck && (
                      <Button size="sm" variant="ghost" onClick={() => onManualCheck(p)} title="בדיקה ידנית" className="text-purple-600 hover:text-purple-700">
                        <FlaskConical className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => onRefresh(p)} title="🔄 רענן עכשיו" disabled={isRefreshing}>
                      {isRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDetails(p)} title="פרטים">
                      <BarChart3 className="w-3.5 h-3.5" />
                    </Button>
                    {onRemove && (
                      <Button size="sm" variant="ghost" onClick={() => onRemove(p)} title="הסר מניטור" className="text-red-500 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}