import React from "react";
import { Check, AlertTriangle, Minus, Loader2 } from "lucide-react";

const LOOK = {
  done: { dot: "bg-emerald-600 border-emerald-600 text-white", title: "text-gray-900", box: "border-gray-200 bg-white" },
  current: { dot: "bg-[#7D0F82] border-[#7D0F82] text-white", title: "text-[#7D0F82]", box: "border-[#7D0F82] bg-purple-50/50" },
  blocked: { dot: "bg-white border-amber-500 text-amber-600", title: "text-amber-800", box: "border-amber-300 bg-amber-50/60" },
  todo: { dot: "bg-white border-gray-300 text-gray-400", title: "text-gray-500", box: "border-gray-200 bg-white" },
  skipped: { dot: "bg-gray-100 border-gray-200 text-gray-400", title: "text-gray-400", box: "border-gray-200 bg-gray-50" },
};

const ICON = { done: Check, current: Loader2, blocked: AlertTriangle, todo: null, skipped: Minus };

export default function OrderProgressBar({ steps }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {steps.map((s, i) => {
        const look = LOOK[s.status] ?? LOOK.todo;
        const Icon = ICON[s.status];
        return (
          <div key={s.key} className={`rounded-2xl border p-3 ${look.box}`}>
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-bold ${look.dot}`}>
                {Icon ? <Icon className={`w-3.5 h-3.5 ${s.status === "current" ? "animate-spin" : ""}`} /> : i + 1}
              </span>
              <span className={`text-sm font-semibold truncate ${look.title}`}>{s.title}</span>
            </div>
            {s.hint && <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">{s.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}