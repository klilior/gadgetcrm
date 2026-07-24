import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export default function LinetReconciliationSummary() {
  const [gaps, setGaps] = useState([]);
  useEffect(() => { base44.entities.InvoiceReconciliationGap.filter({ status: 'open' }, '-detected_at', 1000).then(setGaps); }, []);
  const missingLinet = gaps.filter((gap) => gap.direction === 'missing_in_linet').length;
  const missingSystem = gaps.filter((gap) => gap.direction === 'missing_in_system').length;
  const ambiguous = gaps.filter((gap) => gap.direction === 'ambiguous_match').length;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-lg border bg-card p-3"><AlertTriangle className="mb-1 h-4 w-4 text-amber-600"/><div className="text-2xl font-semibold">{missingLinet}</div><div className="text-sm text-muted-foreground">נקלטו כאן וחסרות בלינט</div></div>
      <div className="rounded-lg border bg-card p-3"><AlertTriangle className="mb-1 h-4 w-4 text-amber-600"/><div className="text-2xl font-semibold">{missingSystem}</div><div className="text-sm text-muted-foreground">קיימות בלינט וחסרות כאן</div></div>
      <div className="rounded-lg border bg-card p-3"><CheckCircle2 className="mb-1 h-4 w-4 text-primary"/><div className="text-2xl font-semibold">{ambiguous}</div><div className="text-sm text-muted-foreground">התאמות אפשריות לבדיקה</div></div>
    </div>
  );
}