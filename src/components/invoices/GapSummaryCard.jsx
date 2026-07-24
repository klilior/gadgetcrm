import React from "react";
import { AlertTriangle } from "lucide-react";

export default function GapSummaryCard({ title, description, gaps }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
      </div>
      <div className="mt-3 text-3xl font-semibold">{gaps.length}</div>
    </div>
  );
}