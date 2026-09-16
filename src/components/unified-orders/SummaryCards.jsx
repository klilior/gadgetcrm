import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Clock3, PhoneCall, AlarmClock } from "lucide-react";

export default function SummaryCards({ stats, activeMetric, onSelectMetric }) {
  const cards = [
    { key: "awaitingShipment", label: "שולמו וממתינות למשלוח", count: stats?.awaitingShipment || 0, icon: Clock3, className: "bg-emerald-50 text-emerald-700 border-emerald-100", ring: "ring-emerald-400" },
    { key: "awaitingPayment", label: "בהשהיה — להתקשר להשלמת תשלום", count: stats?.awaitingPayment || 0, icon: PhoneCall, className: "bg-amber-50 text-amber-700 border-amber-100", ring: "ring-amber-400" },
    { key: "stale", label: "בטיפול מעל 7 ימים", count: stats?.stale || 0, icon: AlarmClock, className: "bg-rose-50 text-rose-700 border-rose-100", ring: "ring-rose-400" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map((c) => {
        const isActive = activeMetric === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelectMetric?.(isActive ? null : c.key)}
            className="text-right w-full"
          >
            <Card className={`rounded-2xl border shadow-sm transition-all hover:shadow-md ${c.className} ${isActive ? `ring-2 ${c.ring}` : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-3xl font-black tracking-tight text-gray-900">{c.count}</p>
                    <p className="text-xs font-semibold mt-1 leading-tight">{c.label}</p>
                    {isActive && <p className="text-[10px] mt-1 opacity-70">לחץ לביטול הסינון</p>}
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-white/70 border border-white flex items-center justify-center flex-shrink-0">
                    <c.icon className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}