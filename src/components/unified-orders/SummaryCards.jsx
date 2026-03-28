import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingBag, DollarSign } from "lucide-react";

export default function SummaryCards({ counts, totalValue }) {
  const cards = [
    { label: "הזמנות אתר", count: counts.woocommerce || 0, color: "from-blue-500 to-blue-600", borderColor: "border-blue-400" },
    { label: "סופר פארם", count: counts.mirakl || 0, color: "from-green-500 to-green-600", borderColor: "border-green-400" },
    { label: "הזמנות לינט", count: counts.linet || 0, color: "from-orange-500 to-orange-600", borderColor: "border-orange-400" },
    { label: "סה\"כ פתוחות", count: counts.total || 0, color: "from-gray-700 to-gray-800", borderColor: "border-gray-500" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className={`border-0 shadow-lg bg-gradient-to-br ${c.color} text-white`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <ShoppingBag className="w-5 h-5 text-white/70" />
            </div>
            <p className="text-2xl font-bold">{c.count}</p>
            <p className="text-xs text-white/80">{c.label}</p>
          </CardContent>
        </Card>
      ))}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-gray-700 to-gray-800 text-white">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-1">
            <DollarSign className="w-5 h-5 text-white/70" />
          </div>
          <p className="text-2xl font-bold">₪{(totalValue || 0).toLocaleString()}</p>
          <p className="text-xs text-white/80">ערך פתוחות</p>
        </CardContent>
      </Card>
    </div>
  );
}