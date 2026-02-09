import React from "react";
import { Package, Bell, Lightbulb, Clock } from "lucide-react";
import { format } from "date-fns";

const cards = [
  { key: "products", label: "סה״כ מוצרים במעקב", icon: Package, color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "alerts", label: "התראות שלא נקראו", icon: Bell, color: "bg-red-50 text-red-700 border-red-200" },
  { key: "recommendations", label: "המלצות חדשות", icon: Lightbulb, color: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "lastCheck", label: "בדיקה אחרונה", icon: Clock, color: "bg-green-50 text-green-700 border-green-200" },
];

export default function SummaryCards({ counts }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(c => {
        const val = counts[c.key];
        return (
          <div key={c.key} className={`rounded-xl border p-4 ${c.color}`}>
            <div className="flex items-center gap-2 mb-2">
              <c.icon className="w-4 h-4" />
              <span className="text-xs font-medium">{c.label}</span>
            </div>
            <div className="text-2xl font-bold">
              {c.key === "lastCheck"
                ? (val ? format(new Date(val), "dd/MM HH:mm") : "—")
                : (val ?? 0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}