import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { format } from "date-fns";

const typeColors = {
  "הורד מחיר כדי להגיע ליעד": "bg-red-100 text-red-800",
  "העלה מחיר - יש מקום": "bg-green-100 text-green-800",
  "הישאר במחיר נוכחי": "bg-blue-100 text-blue-800",
  "אזהרה - מתחת לרווח מינימלי": "bg-orange-100 text-orange-800",
  "לא ניתן להגיע ליעד": "bg-gray-100 text-gray-800",
};

export default function RecommendationsTable({ recommendations, products, onMarkDone, onIgnore }) {
  const getProductName = (id) => products?.find(p => p.id === id)?.product_name || "—";

  if (!recommendations || recommendations.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        אין המלצות חדשות
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50/80">
            <th className="p-3 text-right font-medium text-gray-600">מוצר</th>
            <th className="p-3 text-center font-medium text-gray-600">זמן</th>
            <th className="p-3 text-center font-medium text-gray-600">סוג המלצה</th>
            <th className="p-3 text-center font-medium text-gray-600">מחיר מוצע</th>
            <th className="p-3 text-center font-medium text-gray-600">סטטוס</th>
            <th className="p-3 text-center font-medium text-gray-600">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {recommendations.map(r => (
            <tr key={r.id} className="border-b hover:bg-gray-50/50 transition-colors">
              <td className="p-3 font-medium">{getProductName(r.linked_product)}</td>
              <td className="p-3 text-center text-xs text-gray-500">
                {r.recommendation_time ? format(new Date(r.recommendation_time), "dd/MM HH:mm") : "—"}
              </td>
              <td className="p-3 text-center">
                <Badge className={`${typeColors[r.recommendation_type] || "bg-gray-100"} text-xs`}>
                  {r.recommendation_type || "—"}
                </Badge>
              </td>
              <td className="p-3 text-center">
                {r.new_suggested_price ? `₪${r.new_suggested_price.toLocaleString()}` : "—"}
              </td>
              <td className="p-3 text-center">
                <Badge variant="outline" className="text-xs">{r.status}</Badge>
              </td>
              <td className="p-3 text-center">
                <div className="flex gap-1 justify-center">
                  <Button size="sm" variant="ghost" onClick={() => onMarkDone(r)} title="סמן כבוצע">
                    <Check className="w-3.5 h-3.5 text-green-600" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onIgnore(r)} title="התעלם">
                    <X className="w-3.5 h-3.5 text-gray-400" />
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