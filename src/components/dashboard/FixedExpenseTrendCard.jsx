import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function FixedExpenseTrendCard({ data, breakdown }) {
  return <Card className="border shadow-sm">
    <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />הוצאות קבועות</CardTitle><p className="text-xs text-muted-foreground">מגמה חודשית ופירוט ספקים מובילים</p></CardHeader>
    <CardContent className="grid md:grid-cols-[1fr_180px] gap-3">
      <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => `₪${Math.round(v / 1000)}k`} /><Tooltip formatter={(value) => `₪${Number(value).toLocaleString()}`} /><Bar dataKey="fixed" name="הוצאות קבועות" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
      <div className="space-y-2 md:border-r md:pr-3"><div className="text-xs font-semibold text-muted-foreground">לפי ספק / סוג</div>{breakdown.slice(0, 5).map((item) => <div key={item.name} className="border-b pb-2"><div className="text-xs font-medium truncate">{item.name}</div><div className="flex justify-between text-xs text-muted-foreground"><span>{item.type}</span><span>₪{item.total.toLocaleString()}</span></div></div>)}{!breakdown.length && <div className="text-xs text-muted-foreground">אין נתונים</div>}</div>
    </CardContent>
  </Card>;
}