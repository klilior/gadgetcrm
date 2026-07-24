import React, { useEffect, useState } from "react";
import { checkRecurringExpenses } from "@/functions/checkRecurringExpenses";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export default function RecurringInvoiceAlerts() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7);
    checkRecurringExpenses({ target_month: month, send_notifications: false })
      .then(response => setResult(response.data))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">בודק חשבוניות מספקים קבועים...</div>;
  const missing = result?.missing_details || [];
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 font-semibold">
        {missing.length ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-green-600" />}
        בקרת ספקים קבועים — החודש
      </div>
      <div className="mt-2 text-sm">{missing.length ? `${missing.length} ספקים חסרים או חלקיים` : "כל החשבוניות הצפויות התקבלו"}</div>
      {missing.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{missing.map(item => (
        <span key={item.supplier_id} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{item.supplier_name}: {item.received_count}/{item.expected_count}</span>
      ))}</div>}
    </div>
  );
}