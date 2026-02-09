import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Filter } from "lucide-react";
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
  "שגיאת בדיקה חוזרת": "🚨",
};

const FILTER_PRESETS = [
  { label: "הכל", value: "all" },
  { label: "דורש טיפול", value: "action" },
  { label: "קריטי", value: "critical" },
];

export default function AlertsFeed({ alerts, onMarkRead, products }) {
  const [filter, setFilter] = useState("all");

  const filteredAlerts = (alerts || []).filter(a => {
    if (filter === "action") return a.requires_action && !a.is_read;
    if (filter === "critical") return a.priority === "קריטי" && !a.is_read;
    return true;
  });

  const getProductName = (id) => {
    const p = products?.find(pr => pr.id === id);
    return p?.product_name || "—";
  };

  return (
    <div>
      {/* Filter presets */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        {FILTER_PRESETS.map(fp => (
          <button
            key={fp.value}
            onClick={() => setFilter(fp.value)}
            className={`px-2.5 py-1 rounded-full text-xs transition-all ${
              filter === fp.value
                ? "bg-blue-100 text-blue-800 font-medium"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {fp.label}
          </button>
        ))}
        <span className="text-xs text-gray-400 mr-auto">{filteredAlerts.length} התראות</span>
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          אין התראות {filter !== "all" ? "בסינון הנוכחי" : "חדשות"}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAlerts.map(a => (
            <div key={a.id} className={`flex items-start gap-3 p-3 rounded-lg border hover:shadow-sm transition-shadow ${a.requires_action ? "bg-red-50/30 border-red-100" : "bg-white"}`}>
              <span className="text-lg mt-0.5">{typeIcons[a.alert_type] || "🔔"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-gray-900">{getProductName(a.linked_product)}</span>
                  <Badge className={`${priorityColors[a.priority] || "bg-gray-100"} text-[10px]`}>
                    {a.priority}
                  </Badge>
                  {a.requires_action && (
                    <Badge className="bg-red-100 text-red-700 text-[10px]">דרושה פעולה</Badge>
                  )}
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
      )}
    </div>
  );
}