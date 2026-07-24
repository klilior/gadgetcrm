import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronLeft, FileWarning } from "lucide-react";
import { checkRecurringExpenses } from "@/functions/checkRecurringExpenses";
import { format } from "date-fns";

export default function ManagerInvoiceAlerts({ pendingCount }) {
  const [missing, setMissing] = useState([]);
  useEffect(() => {
    checkRecurringExpenses({ target_month: format(new Date(), "yyyy-MM"), send_notifications: false })
      .then((response) => setMissing(response?.data?.missing_details || []));
  }, []);
  const alerts = [
    pendingCount > 0 && { key: "review", title: `${pendingCount} חשבוניות ממתינות לאימות`, text: "נדרשת בדיקה לפני אישור", to: "/ExpensesInvoicesHub?tab=review", icon: AlertCircle, tone: "border-amber-300 bg-amber-50 text-amber-900" },
    missing.length > 0 && { key: "missing", title: `${missing.length} ספקים קבועים ללא חשבונית מלאה`, text: missing.slice(0, 3).map((item) => item.supplier_name).join(" · "), to: "/ExpensesInvoicesHub?tab=recurring", icon: FileWarning, tone: "border-red-200 bg-red-50 text-red-900" }
  ].filter(Boolean);
  if (!alerts.length) return null;
  return <section aria-label="התראות חשבוניות" className="space-y-2">
    <h2 className="text-sm font-semibold text-foreground">דורש טיפול</h2>
    {alerts.map((alert) => <Link key={alert.key} to={alert.to} className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:bg-card ${alert.tone}`}>
      <div className="flex items-center gap-3 min-w-0"><alert.icon className="h-5 w-5 shrink-0" /><div className="min-w-0"><div className="font-semibold">{alert.title}</div><div className="text-xs opacity-80 truncate">{alert.text}</div></div></div>
      <ChevronLeft className="h-5 w-5 shrink-0" />
    </Link>)}
  </section>;
}