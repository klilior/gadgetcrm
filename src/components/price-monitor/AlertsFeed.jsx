import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { format } from "date-fns";

const priorityColors = {
  "קריטי": "bg-red-100 text-red-800",
  "גבוה": "bg-orange-100 text-orange-800",
  "בינוני": "bg-yellow-100 text-yellow-800",
  "נמוך": "bg-blue-100 text-blue-800",
};

const typeIcons = {
  "ירדנו מתחת למיקום רצוי": "📉",
  "המיקום שלנו השתפר": "📈",
  "מתחרה מעלינו שינה מחיר": "🔄",
  "מתחרה מתחתינו שינה מחיר": "🔄",
  "הזדמנות להעלות מחיר": "💰",
  "מתחת לרווח מינימלי": "⚠️",
  "מלחמת מחירים": "🔥",
};

export default function AlertsFeed({ alerts, onMarkRead, products }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        אין התראות חדשות
      </div>
    );
  }

  const getProductName = (id) => {
    const p = products?.find(pr => pr.id === id);
    return p?.product_name || "—";
  };

  return (
    <div className="space-y-2">
      {alerts.map(a => (
        <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg bg-white border hover:shadow-sm transition-shadow">
          <span className="text-lg mt-0.5">{typeIcons[a.alert_type] || "🔔"}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-gray-900">{getProductName(a.linked_product)}</span>
              <Badge className={`${priorityColors[a.priority] || "bg-gray-100"} text-[10px]`}>
                {a.priority}
              </Badge>
            </div>
            <p className="text-xs text-gray-600 mt-0.5">{a.alert_type}</p>
            {a.message && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.message}</p>}
            <span className="text-[10px] text-gray-400 mt-1 block">
              {a.alert_timestamp ? format(new Date(a.alert_timestamp), "dd/MM HH:mm") : ""}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onMarkRead(a)} title="סמן כנקרא" className="flex-shrink-0">
            <Check className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}