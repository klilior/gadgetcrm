import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Bar({ label, actual = 0, target = 0, isAmount = false }) {
  const percent = target > 0 ? Math.round((actual / target) * 100) : 0;
  const color = percent >= 100 ? "green" : percent >= 60 ? "amber" : "red";
  const bg = color === "green" ? "bg-green-500" : color === "amber" ? "bg-amber-500" : "bg-red-500";
  const strip = color === "green" ? "bg-green-100" : color === "amber" ? "bg-amber-100" : "bg-red-100";
  const format = (v) => (isAmount ? `₪${Number(v || 0).toLocaleString()}` : Number(v || 0).toLocaleString());

  if ((target || 0) === 0 && (actual || 0) === 0) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between items-center text-sm">
          <span className="font-medium text-gray-700">{label}</span>
          <span className="text-gray-400">-</span>
        </div>
        <div className={`h-3 rounded-full ${strip}`} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">
          {format(actual)} / {format(target)}
          <span className={`mr-2 font-bold ${color === "green" ? "text-green-600" : color === "amber" ? "text-amber-600" : "text-red-600"}`}>
            ({percent}%)
          </span>
        </span>
      </div>
      <div className={`h-3 rounded-full ${strip} overflow-hidden`}>
        <div className={`h-full ${bg}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

export default function SalesVsTarget({ periodLabel = "החודש", targets = {}, actuals = {} }) {
  const rows = [
    { key: "Devices", label: "מכשירים", isAmount: false },
    { key: "AccessoriesRevenue", label: "אביזרים (₪)", isAmount: true },
    { key: "Lines", label: "קווים", isAmount: false },
  ];

  const hasAny = rows.some(r => (targets?.[r.key] || 0) > 0 || (actuals?.[r.key] || 0) > 0);

  return (
    <Card className="border border-gray-100">
      <CardHeader className="pb-2">
        <CardTitle className="text-gray-900">יעד מול ביצוע - {periodLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasAny ? (
          <div className="space-y-4">
            {rows.map(r => (
              <Bar
                key={r.key}
                label={r.label}
                actual={actuals?.[r.key] || 0}
                target={targets?.[r.key] || 0}
                isAmount={r.isAmount}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500">
            לא הוגדרו יעדים לתקופה זו
          </div>
        )}
      </CardContent>
    </Card>
  );
}