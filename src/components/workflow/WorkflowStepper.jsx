import React from "react";
import { Check, Circle, AlertTriangle, MinusCircle } from "lucide-react";

const STATE = {
  done: { icon: Check, ring: "bg-emerald-600 text-white border-emerald-600", label: "הושלם" },
  ready: { icon: Circle, ring: "bg-white text-purple-700 border-purple-500", label: "מוכן לביצוע" },
  in_progress: { icon: Circle, ring: "bg-white text-purple-700 border-purple-500", label: "בתהליך" },
  todo: { icon: Circle, ring: "bg-white text-gray-400 border-gray-300", label: "ממתין" },
  blocked: { icon: AlertTriangle, ring: "bg-white text-amber-700 border-amber-500", label: "חסום" },
  not_required: { icon: MinusCircle, ring: "bg-gray-50 text-gray-400 border-gray-200", label: "לא נדרש" },
};

export default function WorkflowStepper({ stages, currentStage, onSelect }) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
      {stages.map((s, i) => {
        const st = STATE[s.status] ?? STATE.todo;
        const Icon = st.icon;
        const active = s.key === currentStage;
        return (
          <button
            key={s.key}
            onClick={() => onSelect?.(s.key)}
            className={`flex-1 min-w-[130px] text-right rounded-xl border px-3 py-2.5 transition-colors
              ${active ? "border-purple-500 bg-purple-50/60" : "border-gray-200 bg-white hover:border-gray-300"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full border flex items-center justify-center ${st.ring}`}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs text-gray-400">{i + 1}</span>
            </div>
            <div className="mt-1.5 text-sm font-medium text-gray-800 truncate">{s.title}</div>
            <div className="text-[11px] text-gray-500 truncate">{st.label}</div>
          </button>
        );
      })}
    </div>
  );
}