import React, { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Target } from 'lucide-react';
import { verifyTargets } from '@/functions/verifyTargets';

function startOfMonth(date) { const d = new Date(date); d.setDate(1); d.setHours(0,0,0,0); return d; }
function endOfMonth(date) { const d = new Date(date); d.setMonth(d.getMonth()+1,0); d.setHours(23,59,59,999); return d; }
function fmt(d) { return d.toISOString().slice(0,10); }

const METRICS = [
  { key: 'Devices', label: 'מכשירים' },
  { key: 'AccessoriesRevenue', label: 'אביזרים (₪)' },
  { key: 'Lines4G', label: '4G' },
  { key: 'Lines5G', label: '5G' },
  { key: 'TotalSalesRevenue', label: 'סה״כ מכירות (₪)' },
];

export default function EmployeeTargetsAudit() {
  const now = new Date();
  const [from, setFrom] = useState(fmt(startOfMonth(now)));
  const [to, setTo] = useState(fmt(endOfMonth(now)));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  const run = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await verifyTargets({ date_from: from, date_to: to });
      if (!data?.success) throw new Error(data?.error || 'Failed');
      setRows(data.rows || []);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const totals = useMemo(() => {
    const t = {};
    for (const m of METRICS) t[m.key] = { actual: 0, target: 0 };
    for (const r of rows) {
      for (const m of METRICS) {
        t[m.key].actual += r.metrics[m.key]?.actual || 0;
        t[m.key].target += r.metrics[m.key]?.target || 0;
      }
    }
    return t;
  }, [rows]);

  const percentBadge = (p) => {
    if (p === null || p === undefined) return <span className="text-gray-400 text-xs">-</span>;
    const cls = p >= 100 ? 'bg-green-100 text-green-700' : p >= 61 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700';
    return <Badge className={`${cls} text-xs`}>{p}%</Badge>;
  };

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5 text-amber-600" /> בדיקת התאמת יעדים לביצועים
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <div className="text-sm mb-1">מתאריך</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="text-sm mb-1">עד תאריך</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={run} disabled={loading} className="bg-amber-600 hover:bg-amber-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'בדוק' }
          </Button>
          {error && <span className="text-red-600 text-sm">{error}</span>}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>נציג</TableHead>
                <TableHead>תפקיד</TableHead>
                {METRICS.map(m => (
                  <TableHead key={m.key} className="text-center">{m.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employee_id}>
                  <TableCell className="font-medium">{r.employee_name}</TableCell>
                  <TableCell>{r.role || '-'}</TableCell>
                  {METRICS.map(m => {
                    const item = r.metrics[m.key] || { actual: 0, target: 0, percent: null };
                    return (
                      <TableCell key={m.key} className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className="text-xs text-gray-500">
                            {m.key.includes('Revenue') ? `₪${item.actual} / ₪${item.target}` : `${item.actual} / ${item.target}`}
                          </div>
                          {percentBadge(item.percent)}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {rows.length > 0 && (
                <TableRow className="bg-amber-50 font-semibold">
                  <TableCell>סה״כ</TableCell>
                  <TableCell></TableCell>
                  {METRICS.map(m => {
                    const a = Math.round(totals[m.key].actual);
                    const t = Math.round(totals[m.key].target);
                    const p = t > 0 ? Math.round((a / t) * 100) : null;
                    return (
                      <TableCell key={m.key} className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className="text-xs text-gray-600">{m.key.includes('Revenue') ? `₪${a} / ₪${t}` : `${a} / ${t}`}</div>
                          {percentBadge(p)}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              )}
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={2 + METRICS.length} className="text-center py-8 text-gray-500">
                    אין נתונים להצגה — בחר תקופה ולחץ בדוק.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}