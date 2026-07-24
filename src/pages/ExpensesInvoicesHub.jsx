import React from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Receipt, Inbox, Upload, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "@/components/UserAuth";
import PurchasesDashboard from "@/pages/PurchasesDashboard";
import InvoicesToReview from "@/pages/InvoicesToReview";
import SuppliersManagement from "@/pages/SuppliersManagement";
import InvoiceGapsView from "@/components/invoices/InvoiceGapsView";
import RecurringExpensesView from "@/components/invoices/RecurringExpensesView";

const TABS = [
  ["business", "סקירה עסקית"], ["review", "חשבוניות לאימות"],
  ["gaps", "פערים מול לינט"], ["suppliers", "ספקים"], ["recurring", "הוצאות קבועות"]
];

export default function ExpensesInvoicesHub() {
  const { currentUser } = useUser();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([value]) => value === params.get("tab")) ? params.get("tab") : "business";
  const isManager = currentUser?.role === "מנהל" || currentUser?.role === "admin";
  if (!isManager) return <div className="p-6 text-center text-destructive">דף זה זמין למנהלים בלבד</div>;
  return <div dir="rtl" className="space-y-4">
    <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="h-6 w-6 text-primary" />הוצאות וחשבוניות</h1><p className="text-sm text-muted-foreground mt-1">מרכז אחד לבקרה, אימות, התאמות וניהול ספקים</p></div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to="/IntakeInbox"><Inbox className="h-4 w-4 ml-1" />תיבת קליטה</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/MobileInvoiceUpload"><Upload className="h-4 w-4 ml-1" />העלאת חשבונית</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/PriceAlerts"><BellRing className="h-4 w-4 ml-1" />התראות מחיר</Link></Button>
      </div>
    </div>
    <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })} dir="rtl">
      <TabsList className="w-full h-auto flex flex-wrap justify-start bg-muted p-1">
        {TABS.map(([value, label]) => <TabsTrigger key={value} value={value} className="flex-1 min-w-[140px]">{label}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="business"><PurchasesDashboard /></TabsContent>
      <TabsContent value="review"><InvoicesToReview /></TabsContent>
      <TabsContent value="gaps"><InvoiceGapsView /></TabsContent>
      <TabsContent value="suppliers"><SuppliersManagement /></TabsContent>
      <TabsContent value="recurring"><RecurringExpensesView /></TabsContent>
    </Tabs>
  </div>;
}