import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, BarChart3 } from "lucide-react";
import { format } from "date-fns";

const statusColors = {
  "🟢 תקין": "bg-green-100 text-green-800 border-green-200",
  "🟡 קרוב ליעד": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "🔴 רחוק מהיעד": "bg-red-100 text-red-800 border-red-200",
  "⚠️ רווח נמוך": "bg-orange-100 text-orange-800 border-orange-200",
};

export default function ActiveProductsTable({ products, onRefresh, onDetails }) {
  if (!products || products.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-lg">אין מוצרים פעילים עדיין</p>
        <p className="text-sm mt-1">הוסף מוצר חדש כדי להתחיל במעקב</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50/80">
            <th className="p-3 text-right font-medium text-gray-600">שם מוצר</th>
            <th className="p-3 text-center font-medium text-gray-600">מחיר נוכחי</th>
            <th className="p-3 text-center font-medium text-gray-600">מיקום רצוי</th>
            <th className="p-3 text-center font-medium text-gray-600">בדיקה אחרונה</th>
            <th className="p-3 text-center font-medium text-gray-600">סטטוס</th>
            <th className="p-3 text-center font-medium text-gray-600">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.id} className="border-b hover:bg-gray-50/50 transition-colors">
              <td className="p-3 font-medium text-gray-900">{p.product_name}</td>
              <td className="p-3 text-center">
                {p.my_current_price ? `₪${p.my_current_price.toLocaleString()}` : "—"}
              </td>
              <td className="p-3 text-center">{p.desired_position ?? "—"}</td>
              <td className="p-3 text-center text-gray-500 text-xs">
                {p.last_check_time ? format(new Date(p.last_check_time), "dd/MM HH:mm") : "טרם נבדק"}
              </td>
              <td className="p-3 text-center">
                <Badge className={`${statusColors[p.status_code] || "bg-gray-100 text-gray-700"} text-xs`}>
                  {p.status_code || "—"}
                </Badge>
              </td>
              <td className="p-3 text-center">
                <div className="flex gap-1 justify-center">
                  <Button size="sm" variant="ghost" onClick={() => onRefresh(p)} title="רענן עכשיו">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDetails(p)} title="פרטים">
                    <BarChart3 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}