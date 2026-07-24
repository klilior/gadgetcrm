import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import GapSummaryCard from "@/components/invoices/GapSummaryCard";

export default function LinetReconciliationSummary() {
  const [gaps, setGaps] = useState([]);
  const [scope, setScope] = useState("recent");
  useEffect(() => { base44.entities.InvoiceReconciliationGap.filter({ status: "open" }, "id", 2000).then(setGaps); }, []);
  const visible = useMemo(() => {
    if (scope === "archive") return gaps;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    return gaps.filter(gap => gap.doc_date && gap.doc_date >= cutoffDate);
  }, [gaps, scope]);
  const missingLinet = visible.filter(gap => gap.direction === "missing_in_linet");
  const missingSystem = visible.filter(gap => gap.direction === "missing_in_system");
  const ambiguous = visible.filter(gap => gap.direction === "ambiguous_match");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div><div className="font-semibold">פערי התאמה מול Linet</div><div className="text-xs text-muted-foreground">{visible.length} פערים פתוחים מוצגים</div></div>
        <div className="flex gap-2"><Button size="sm" variant={scope === "recent" ? "default" : "outline"} onClick={() => setScope("recent")}>90 ימים אחרונים</Button><Button size="sm" variant={scope === "archive" ? "default" : "outline"} onClick={() => setScope("archive")}>ארכיון מלא</Button></div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <GapSummaryCard title="קיים אצלי אך חסר בלינט" description="דורש קליטה ידנית ללינט" gaps={missingLinet} />
        <GapSummaryCard title="קיים בלינט אך חסר במערכת" description="דורש איתור או קליטת חשבונית במערכת" gaps={missingSystem} />
      </div>
      {ambiguous.length > 0 && <div className="text-sm text-muted-foreground">בנוסף: {ambiguous.length} התאמות אפשריות לבדיקה</div>}
    </div>
  );
}