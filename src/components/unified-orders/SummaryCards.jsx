import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Layers, Clock3, PhoneCall, AlarmClock } from "lucide-react";

export default function SummaryCards({ stats }) {
  const cards = [
    { label: 'סה"כ פתוחות', count: stats?.open || 0, icon: Layers, className: "bg-slate-50 text-slate-700 border-slate-100" },
    { label: "שולמו וממתינות למשלוח", count: stats?.awaitingShipment || 0, icon: Clock3, className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
    { label: "בהשהיה — להתקשר להשלמת תשלום", count: stats?.awaitingPayment || 0, icon: PhoneCall, className: "bg-amber-50 text-amber-700 border-amber-100" },
    { label: "בטיפול מעל 7 ימים", count: stats?.stale || 0, icon: AlarmClock, className: "bg-rose-50 text-rose-700 border-rose-100" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className={`rounded-2xl border shadow-sm ${c.className}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-3xl font-black tracking-tight text-gray-900">{c.count}</p>
                <p className="text-xs font-semibold mt-1 leading-tight">{c.label}</p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-white/70 border border-white flex items-center justify-center flex-shrink-0">
                <c.icon className="w-4 h-4" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}