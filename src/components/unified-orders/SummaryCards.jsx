import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Globe, Pill, FileText, Layers } from "lucide-react";

export default function SummaryCards({ counts }) {
  const cards = [
    { label: "הזמנות אתר", count: counts.woocommerce || 0, gradient: "from-purple-500 via-purple-600 to-violet-700", icon: Globe, glow: "shadow-purple-500/20" },
    { label: "סופר פארם", count: counts.mirakl || 0, gradient: "from-blue-500 via-blue-600 to-cyan-600", icon: Pill, glow: "shadow-blue-500/20" },
    { label: "הזמנות לינט", count: counts.linet || 0, gradient: "from-amber-400 via-orange-500 to-orange-600", icon: FileText, glow: "shadow-orange-500/20" },
    { label: 'סה"כ פתוחות', count: counts.total || 0, gradient: "from-slate-700 via-slate-800 to-slate-900", icon: Layers, glow: "shadow-slate-500/20" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className={`border-0 shadow-xl ${c.glow} bg-gradient-to-br ${c.gradient} text-white rounded-2xl overflow-hidden relative group hover:scale-[1.02] transition-transform duration-200`}>
          <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          <CardContent className="p-4 relative">
            <div className="flex items-center justify-between mb-2">
              <c.icon className="w-5 h-5 text-white/60" />
              <div className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
                <span className="text-sm font-bold">{c.count}</span>
              </div>
            </div>
            <p className="text-3xl font-black tracking-tight">{c.count}</p>
            <p className="text-xs text-white/70 mt-1 font-medium">{c.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}