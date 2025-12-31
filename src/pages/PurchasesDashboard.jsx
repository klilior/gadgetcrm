import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, RefreshCcw } from "lucide-react";
import { useUser } from "../components/UserAuth";
import { startOfMonth, endOfMonth, subWeeks, startOfWeek, endOfWeek, isAfter, isBefore } from "date-fns";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function PurchasesDashboard() {
  const { currentUser } = useUser();
  const forbidden = currentUser?.role === 'נציג' || currentUser?.role === 'מנהל משמרת';

  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Invoices.filter({ extraction_status: 'אושר' }, '-doc_date', 1000);
      setRows(list || []);
      const sups = await base44.entities.Suppliers.list(500);
      const map = {}; (sups || []).forEach(s => { map[s.id] = s; });
      setSuppliers(map);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (forbidden) {
    return (
      <div className="p-6 text-center">
        <h1 className="text-2xl font-bold text-red-600">אין הרשאה</h1>
        <p className="text-gray-600 mt-2">דף זה זמין למנהלים בלבד</p>
      </div>
    );
  }

  const now = new Date();
  const mStart = startOfMonth(now); const mEnd = endOfMonth(now);
  const inMonth = (r) => {
    if (!r.doc_date) return false;
    const d = new Date(r.doc_date);
    return !isBefore(d, mStart) && !isAfter(d, mEnd);
  };

  const purchases = rows.filter(r => r.doc_type === 'חשבונית מס' && inMonth(r));
  const credits = rows.filter(r => r.doc_type === 'חשבונית זיכוי' && inMonth(r));
  const sum = (arr) => arr.reduce((acc, r) => acc + (Number(r.total_with_vat) || 0), 0);
  const purchasesSum = sum(purchases);
  const creditsSum = sum(credits);

  // Top 10 suppliers
  const topSuppliers = useMemo(() => {
    const agg = {};
    for (const r of purchases) {
      const key = r.supplier || 'unknown';
      agg[key] = (agg[key] || 0) + (Number(r.total_with_vat) || 0);
    }
    const items = Object.entries(agg).map(([id, total]) => ({ id, name: suppliers[id]?.name || id, total }));
    items.sort((a,b) => b.total - a.total);
    return items.slice(0, 10);
  }, [purchases, suppliers]);

  // Weekly trend - last 8 weeks
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = endOfWeek(subWeeks(now, i), { weekStartsOn: 0 });
    const start = startOfWeek(end, { weekStartsOn: 0 });
    return { start, end };
  }).reverse();

  const weeklyData = weeks.map((w) => {
    const sumW = rows.filter(r => r.doc_type === 'חשבונית מס' && r.doc_date && !isBefore(new Date(r.doc_date), w.start) && !isAfter(new Date(r.doc_date), w.end))
      .reduce((acc, r) => acc + (Number(r.total_with_vat) || 0), 0);
    const label = `${w.start.getDate()}/${w.start.getMonth()+1}`;
    return { name: label, total: sumW };
  });

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6"/> דשבורד רכישות</h1>
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCcw className="w-4 h-4"/>רענן</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="glass-card border-0">
          <CardHeader><CardTitle>סה״כ רכישות החודש (כולל מע״מ)</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-emerald-700">₪ {purchasesSum.toLocaleString()}</CardContent>
        </Card>
        <Card className="glass-card border-0">
          <CardHeader><CardTitle>סה״כ זיכויים החודש</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold text-rose-700">₪ {creditsSum.toLocaleString()}</CardContent>
        </Card>
      </div>

      <Card className="glass-card border-0">
        <CardHeader><CardTitle>Top 10 ספקים החודש</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {topSuppliers.length === 0 ? (
              <div className="text-gray-500">אין נתונים</div>
            ) : topSuppliers.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between border-b py-1">
                <div className="text-sm">{i+1}. {s.name}</div>
                <div className="font-semibold">₪ {s.total.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-0">
        <CardHeader><CardTitle>מגמת רכישות שבועית (8 שבועות אחרונים)</CardTitle></CardHeader>
        <CardContent style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}