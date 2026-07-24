import React from "react";
import { RefreshCw } from "lucide-react";
import LinetReconciliationSummary from "@/components/invoices/LinetReconciliationSummary";

export default function InvoiceGapsView() {
  return <div dir="rtl" className="p-4 space-y-4">
    <div><h2 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="h-6 w-6" />פערים מול לינט</h2><p className="text-sm text-muted-foreground mt-1">חשבוניות ומסמכי רכש שדורשים התאמה</p></div>
    <div className="rounded-xl border bg-card p-4 shadow-sm"><LinetReconciliationSummary /></div>
  </div>;
}