import React, { useMemo } from "react";
import { Clock } from "lucide-react";
import useSuppliers from "@/components/hooks/useSuppliers";
import RecurringExpenseTable from "@/components/recurring-expenses/RecurringExpenseTable";

export default function RecurringExpensesView() {
  const { suppliersList } = useSuppliers();
  const recurring = useMemo(() => suppliersList.filter((s) => s.is_recurring || s.is_recurring_expense), [suppliersList]);
  return <div dir="rtl" className="p-4 space-y-4">
    <div><h2 className="text-2xl font-bold flex items-center gap-2"><Clock className="h-6 w-6" />הוצאות קבועות</h2><p className="text-sm text-muted-foreground mt-1">מעקב חודשי אחר חשבוניות צפויות מספקים קבועים</p></div>
    {recurring.length ? <RecurringExpenseTable recurringSuppliers={recurring} /> : <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">לא הוגדרו ספקי הוצאה קבועה</div>}
  </div>;
}