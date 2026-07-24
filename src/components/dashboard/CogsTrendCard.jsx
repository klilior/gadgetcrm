import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Percent } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function CogsTrendCard({ data }) {
  const current = data.at(-1)?.cogs || 0;
  return <Card className="border shadow-sm">
    <CardHeader className="pb-2"><CardTitle className="text-base flex items-center justify-between"><span className="flex items-center gap-2"><Percent className="h-5 w-5 text-primary" />אחוז הסחורה מהמחזור</span><span className="text-2xl">{current}%</span></CardTitle><p className="text-xs text-muted-foreground">מגמה חודשית לניהול רווחיות</p></CardHeader>
    <CardContent className="h-64 pt-2"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" fontSize={11} /><YAxis unit="%" fontSize={11} /><Tooltip formatter={(value) => `${value}%`} /><Line type="monotone" dataKey="cogs" name="COGS" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></CardContent>
  </Card>;
}