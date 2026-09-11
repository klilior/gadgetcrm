import React from "react";
import { AlertTriangle, CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WorkflowStageDetail({ stage, onOpenOrder }) {
  if (!stage) return null;
  const isDone = stage.status === "done" || stage.status === "not_required";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-gray-900">{stage.title}</div>
          <div className="text-sm text-gray-500 mt-0.5">{stage.detail}</div>
        </div>
        {isDone && <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />}
      </div>

      {stage.blockers?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
            <AlertTriangle className="w-4 h-4" />
            נקודת עצירה
          </div>
          {stage.blockers.map((b, i) => (
            <div key={i} className="text-sm text-amber-900">• {b}</div>
          ))}
        </div>
      )}

      {stage.next_action && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <span className="text-sm text-gray-700">הפעולה הבאה: {stage.next_action}</span>
          <Button size="sm" onClick={onOpenOrder} className="bg-purple-700 hover:bg-purple-800">
            פתח בהזמנות
            <ArrowLeft className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}