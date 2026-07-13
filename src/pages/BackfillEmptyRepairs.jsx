import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, AlertTriangle, CheckCircle2, Wrench, Lock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useUser } from '../components/UserAuth';

// VendorReport formulas (kept consistent):
//   gross = final_price - part_cost
//   lab   = part_cost + gross / 2
//   net   = final_price - lab
const calc = (finalPrice, partCost) => {
  const fp = parseFloat(finalPrice) || 0;
  const pc = parseFloat(partCost) || 0;
  const gross = fp - pc;
  const lab = pc + gross / 2;
  const net = fp - lab;
  return { fp, pc, gross, lab, net };
};

const fmt = (n) => `₪${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? format(parseISO(d), 'dd/MM/yy HH:mm') : '—');

export default function BackfillEmptyRepairs() {
  const { currentUser } = useUser();
  const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin';

  const [repairs, setRepairs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  // per-row editable draft state (keyed by repair id) — NOT persisted
  const [drafts, setDrafts] = useState({});
  const [reviewed, setReviewed] = useState({});

  useEffect(() => {
    if (isManager) loadData();
    else setIsLoading(false);
  }, [currentUser]);

  const loadData = async () => {
    setIsLoading(true);
    let closed = [];
    try {
      closed = await base44.entities.Repair.filter(
        {
          repair_type: 'מעבדת Gadget-Team',
          status: { $in: ['תיקון נסגר', 'מכשיר סיים תיקון וממתין לאיסוף'] },
        },
        '-updated_date',
        1000
      );
    } catch (err) {
      console.error('Error loading repairs:', err);
    }
    // empty = final_price null or 0
    const empty = closed.filter((r) => !r.final_price || r.final_price === 0);
    setRepairs(empty);

    // seed drafts for backfillable rows with expected_price as default final_price
    const seed = {};
    empty.forEach((r) => {
      seed[r.id] = {
        final_price: (r.expected_price && r.expected_price > 0) ? r.expected_price : '',
        part_cost: r.part_cost || 0,
      };
    });
    setDrafts(seed);
    setIsLoading(false);
  };

  const backfillable = useMemo(
    () => repairs.filter((r) => r.expected_price && r.expected_price > 0),
    [repairs]
  );
  const noSource = useMemo(
    () => repairs.filter((r) => !r.expected_price || r.expected_price <= 0),
    [repairs]
  );

  const setDraft = (id, field, value) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  // Running total of proposed lab-debt impact (only reviewed rows)
  const proposedTotal = useMemo(() => {
    return backfillable.reduce((sum, r) => {
      if (!reviewed[r.id]) return sum;
      const d = drafts[r.id] || {};
      const { lab } = calc(d.final_price, d.part_cost);
      return sum + lab;
    }, 0);
  }, [backfillable, drafts, reviewed]);

  const reviewedCount = backfillable.filter((r) => reviewed[r.id]).length;

  if (!isManager) {
    return (
      <div className="p-6 text-center text-gray-600" dir="rtl">
        <Lock className="w-10 h-10 mx-auto mb-3 text-gray-400" />
        מסך זה זמין למנהלים בלבד.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-purple-600 animate-spin" />
          <p className="text-lg text-gray-600">טוען תיקונים ריקים...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-purple-600" />
            השלמת תיקונים ריקים
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            תיקונים סגורים של מעבדת Gadget-Team שנסגרו ללא מחיר סופי
          </p>
        </div>
        <Badge variant="secondary" className="text-sm px-3 py-1.5">📋 מצב צפיה והכנה בלבד</Badge>
      </div>

      {/* Read-only warning banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          מסך זה מציג נתונים ומכין הצעות בלבד. <b>לא נשמר דבר</b> — המחיר הצפוי הוא הערכת קליטה
          ולא בהכרח הסכום שנגבה בפועל, ולכן כל שורה דורשת בדיקת מנהל לפני שמירה עתידית.
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white/80 backdrop-blur-sm border-white/40">
          <CardContent className="p-4">
            <div className="text-sm text-gray-500">סה״כ תיקונים ריקים</div>
            <div className="text-2xl font-bold text-gray-900">{repairs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-white/80 backdrop-blur-sm border-white/40">
          <CardContent className="p-4">
            <div className="text-sm text-gray-500">ניתנים להשלמה (מחיר צפוי {'>'} 0)</div>
            <div className="text-2xl font-bold text-green-600">{backfillable.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-white/80 backdrop-blur-sm border-white/40">
          <CardContent className="p-4">
            <div className="text-sm text-gray-500">ללא מקור מחיר</div>
            <div className="text-2xl font-bold text-red-500">{noSource.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Backfillable section */}
      <Card className="bg-white/80 backdrop-blur-sm border-white/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            ניתנים להשלמה — עם מחיר צפוי ({backfillable.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {backfillable.length === 0 ? (
            <div className="text-center py-8 text-gray-500">אין תיקונים ניתנים להשלמה</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center">נבדק</TableHead>
                    <TableHead>מס׳ תיקון</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>נוצר</TableHead>
                    <TableHead>עודכן</TableHead>
                    <TableHead className="text-right">מחיר צפוי</TableHead>
                    <TableHead className="text-right">מחיר סופי (הצעה)</TableHead>
                    <TableHead className="text-right">עלות חלק</TableHead>
                    <TableHead className="text-right font-bold text-orange-700">תשלום למעבדה</TableHead>
                    <TableHead className="text-right font-bold text-green-700">רווח נקי</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backfillable.map((r) => {
                    const d = drafts[r.id] || {};
                    const { lab, net } = calc(d.final_price, d.part_cost);
                    const isReviewed = !!reviewed[r.id];
                    return (
                      <TableRow key={r.id} className={isReviewed ? 'bg-green-50/60' : ''}>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={isReviewed}
                            onCheckedChange={(v) =>
                              setReviewed((prev) => ({ ...prev, [r.id]: !!v }))
                            }
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-purple-700">{r.repair_id || '—'}</TableCell>
                        <TableCell className="text-xs">{r.status}</TableCell>
                        <TableCell className="text-xs text-gray-500">{fmtDate(r.created_date)}</TableCell>
                        <TableCell className="text-xs text-gray-500">{fmtDate(r.updated_date)}</TableCell>
                        <TableCell className="text-right text-blue-600 font-semibold">
                          {fmt(r.expected_price)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={d.final_price}
                            onChange={(e) => setDraft(r.id, 'final_price', e.target.value)}
                            className="w-24 ml-auto"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={d.part_cost}
                            onChange={(e) => setDraft(r.id, 'part_cost', e.target.value)}
                            className="w-24 ml-auto"
                          />
                        </TableCell>
                        <TableCell className="text-right font-bold text-orange-600">{fmt(lab)}</TableCell>
                        <TableCell className="text-right font-bold text-green-600">{fmt(net)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Running total + disabled save */}
          <div className="mt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm">
              <span className="text-gray-600">נבדקו: </span>
              <b>{reviewedCount}</b>
              <span className="text-gray-600"> מתוך {backfillable.length}</span>
              <span className="mx-3 text-gray-300">|</span>
              <span className="text-gray-600">השפעת חוב מעבדה מוצעת (שורות שנבדקו): </span>
              <b className="text-orange-600">{fmt(proposedTotal)}</b>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button disabled className="opacity-60 cursor-not-allowed">
                שמירת שינויים
              </Button>
              <span className="text-xs text-gray-400">כתיבה תופעל בשלב נפרד לאחר אישור</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* No source section */}
      <Card className="bg-white/80 backdrop-blur-sm border-white/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            ללא מקור מחיר — לא ניתנים להשלמה אוטומטית ({noSource.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {noSource.length === 0 ? (
            <div className="text-center py-8 text-gray-500">אין שורות ללא מקור מחיר</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>מס׳ תיקון</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>נוצר</TableHead>
                    <TableHead>עודכן</TableHead>
                    <TableHead className="text-right">עלות חלק</TableHead>
                    <TableHead className="text-right">מחיר סופי</TableHead>
                    <TableHead className="text-right">מחיר צפוי</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noSource.map((r) => (
                    <TableRow key={r.id} className="bg-red-50/40">
                      <TableCell className="font-mono text-xs text-purple-700">{r.repair_id || '—'}</TableCell>
                      <TableCell className="text-xs">{r.status}</TableCell>
                      <TableCell className="text-xs text-gray-500">{fmtDate(r.created_date)}</TableCell>
                      <TableCell className="text-xs text-gray-500">{fmtDate(r.updated_date)}</TableCell>
                      <TableCell className="text-right">{fmt(r.part_cost)}</TableCell>
                      <TableCell className="text-right text-gray-400">{fmt(r.final_price)}</TableCell>
                      <TableCell className="text-right text-gray-400">—</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}