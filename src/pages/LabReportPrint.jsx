import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, ShieldAlert } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useUser } from '@/components/UserAuth';
import LabReportFilters from '@/components/vendor-report/LabReportFilters';

const money = (n) => `₪${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const defaultFilters = () => {
  const p = new URLSearchParams(window.location.search);
  return {
    from: p.get('from') || '2026-07-21',
    to: p.get('to') || format(new Date(), 'yyyy-MM-dd'),
    client: '', device: '', repairId: '', minPrice: '', maxPrice: '', takenBy: '',
    showRepairs: true, showCredits: true, showPayments: true,
    onlyWithPartCost: false, summaryOnly: false,
  };
};

export default function LabReportPrint() {
  const { currentUser, isLoading: userLoading } = useUser();
  const isManager = currentUser?.role === 'מנהל' || currentUser?.role === 'admin' ||
    currentUser?.app_role === 'מנהל' || currentUser?.data?.app_role === 'מנהל';

  const [f, setF] = useState(defaultFilters);
  const set = (patch) => setF(prev => ({ ...prev, ...patch }));

  const [repairs, setRepairs] = useState([]);
  const [credits, setCredits] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (isManager) load(); }, [f.from, f.to, isManager]);

  const load = async () => {
    setLoading(true);
    const start = new Date(`${f.from}T00:00:00`);
    const end = new Date(`${f.to}T23:59:59`);
    const inRange = (d) => d && new Date(d) >= start && new Date(d) <= end;

    const [allRepairs, allCredits, allPayments] = await Promise.all([
      base44.entities.Repair.filter(
        { repair_type: "מעבדת Gadget-Team", status: { $in: ["תיקון נסגר", "מכשיר סיים תיקון וממתין לאיסוף"] } },
        "-updated_date", 500
      ),
      base44.entities.LabCredit.list('-created_date', 500),
      base44.entities.LabPayment.list('-created_date', 500),
    ]);

    const R = allRepairs.filter(r => inRange(r.updated_date));
    const clientIds = [...new Set(R.map(r => r.client_id).filter(Boolean))];
    const clients = clientIds.length ? await base44.entities.Client.filter({ id: { $in: clientIds } }) : [];
    const cMap = clients.reduce((a, c) => ({ ...a, [c.id]: c }), {});

    setRepairs(R.map(r => {
      const fp = r.final_price || 0, pc = r.part_cost || 0;
      const lab = ((fp - pc) / 2) + pc;
      return {
        id: r.id, repair_id: r.repair_id, date: r.updated_date,
        client: cMap[r.client_id]?.full_name || '—',
        device: [r.device_brand, r.device_model].filter(Boolean).join(' ') || r.device_type || '—',
        issue: r.problem_description || r.repair_description || '',
        fp, pc, gross: fp - pc, lab, net: fp - lab,
      };
    }));
    setCredits(allCredits.filter(c => inRange(c.taken_date || c.created_date)));
    setPayments(allPayments.filter(p => inRange(p.payment_date || p.created_date)));
    setLoading(false);
  };

  const rows = useMemo(() => {
    const t = (s) => (s || '').toLowerCase();
    return repairs.filter(r => {
      if (f.client && !t(r.client).includes(t(f.client))) return false;
      if (f.device && !(t(r.device).includes(t(f.device)) || t(r.issue).includes(t(f.device)))) return false;
      if (f.repairId && !String(r.repair_id || '').includes(f.repairId)) return false;
      if (f.minPrice !== '' && r.fp < Number(f.minPrice)) return false;
      if (f.maxPrice !== '' && r.fp > Number(f.maxPrice)) return false;
      if (f.onlyWithPartCost && !r.pc) return false;
      return true;
    });
  }, [repairs, f]);

  const creditRows = useMemo(() => credits.filter(c =>
    !f.takenBy || (c.taken_by || '').toLowerCase().includes(f.takenBy.toLowerCase())
  ), [credits, f.takenBy]);

  const totals = rows.reduce((t, r) => ({
    fp: t.fp + r.fp, pc: t.pc + r.pc, gross: t.gross + r.gross, lab: t.lab + r.lab, net: t.net + r.net,
  }), { fp: 0, pc: 0, gross: 0, lab: 0, net: 0 });
  const labDebt = f.showRepairs ? totals.lab : 0;
  const totalCredits = f.showCredits ? creditRows.reduce((s, c) => s + (c.amount || 0), 0) : 0;
  const totalPaid = f.showPayments ? payments.reduce((s, p) => s + (p.amount || 0), 0) : 0;
  const balance = labDebt - totalCredits - totalPaid;

  if (userLoading) {
    return <div className="p-6 flex items-center gap-2 text-gray-600"><Loader2 className="w-5 h-5 animate-spin" /> טוען...</div>;
  }

  if (!isManager) {
    return (
      <div dir="rtl" className="p-10 text-center">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-gray-800">הדוח זמין למנהלים בלבד</h1>
        <p className="text-sm text-gray-500 mt-1">אין לך הרשאה לצפות בדוח ההתחשבנות עם המעבדה.</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-5xl mx-auto">
      <LabReportFilters f={f} set={set} onReset={() => setF(defaultFilters())} onPrint={() => window.print()} />

      {loading ? (
        <div className="flex items-center gap-2 text-gray-600"><Loader2 className="w-5 h-5 animate-spin" /> טוען...</div>
      ) : (
        <div className="bg-white p-6 rounded-xl border print:border-0 print:p-0">
          <div className="text-center mb-5">
            <h1 className="text-xl font-bold">דוח התחשבנות — מעבדת Gadget-Team</h1>
            <p className="text-sm text-gray-600">
              {format(parseISO(f.from), 'dd/MM/yyyy')} – {format(parseISO(f.to), 'dd/MM/yyyy')} · {rows.length} תיקונים
            </p>
          </div>

          {f.showRepairs && !f.summaryOnly && (
            <table className="w-full text-xs border-collapse mb-6">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-1.5 text-right">תאריך</th>
                  <th className="border p-1.5 text-right">מס׳ תיקון</th>
                  <th className="border p-1.5 text-right">לקוח</th>
                  <th className="border p-1.5 text-right">מכשיר</th>
                  <th className="border p-1.5 text-left">הכנסה</th>
                  <th className="border p-1.5 text-left">עלות חלק</th>
                  <th className="border p-1.5 text-left">רווח גולמי</th>
                  <th className="border p-1.5 text-left">למעבדה</th>
                  <th className="border p-1.5 text-left">רווח נקי</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="border p-1.5">{format(parseISO(r.date), 'dd/MM/yy')}</td>
                    <td className="border p-1.5 font-mono">{r.repair_id}</td>
                    <td className="border p-1.5">{r.client}</td>
                    <td className="border p-1.5">{r.device}</td>
                    <td className="border p-1.5 text-left">{money(r.fp)}</td>
                    <td className="border p-1.5 text-left">{money(r.pc)}</td>
                    <td className="border p-1.5 text-left">{money(r.gross)}</td>
                    <td className="border p-1.5 text-left font-semibold">{money(r.lab)}</td>
                    <td className="border p-1.5 text-left">{money(r.net)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-bold">
                  <td className="border p-1.5" colSpan={4}>סה״כ</td>
                  <td className="border p-1.5 text-left">{money(totals.fp)}</td>
                  <td className="border p-1.5 text-left">{money(totals.pc)}</td>
                  <td className="border p-1.5 text-left">{money(totals.gross)}</td>
                  <td className="border p-1.5 text-left">{money(totals.lab)}</td>
                  <td className="border p-1.5 text-left">{money(totals.net)}</td>
                </tr>
              </tbody>
            </table>
          )}

          {f.showCredits && !f.summaryOnly && creditRows.length > 0 && (
            <>
              <h2 className="font-semibold text-sm mb-2">מוצרים שנלקחו ({creditRows.length})</h2>
              <table className="w-full text-xs border-collapse mb-6">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border p-1.5 text-right">תאריך</th>
                    <th className="border p-1.5 text-right">מי לקח</th>
                    <th className="border p-1.5 text-right">מוצר</th>
                    <th className="border p-1.5 text-left">שווי</th>
                  </tr>
                </thead>
                <tbody>
                  {creditRows.map(c => (
                    <tr key={c.id}>
                      <td className="border p-1.5">{format(parseISO(c.taken_date || c.created_date), 'dd/MM/yy')}</td>
                      <td className="border p-1.5">{c.taken_by}</td>
                      <td className="border p-1.5">{c.product_description}</td>
                      <td className="border p-1.5 text-left">{money(c.amount)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="border p-1.5" colSpan={3}>סה״כ זיכויים</td>
                    <td className="border p-1.5 text-left">{money(totalCredits)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {f.showPayments && !f.summaryOnly && payments.length > 0 && (
            <>
              <h2 className="font-semibold text-sm mb-2">תשלומים ({payments.length})</h2>
              <table className="w-full text-xs border-collapse mb-6">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border p-1.5 text-right">תאריך</th>
                    <th className="border p-1.5 text-right">סוג</th>
                    <th className="border p-1.5 text-left">סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td className="border p-1.5">{format(parseISO(p.payment_date || p.created_date), 'dd/MM/yy')}</td>
                      <td className="border p-1.5">{p.payment_type || '—'}</td>
                      <td className="border p-1.5 text-left">{money(p.amount)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="border p-1.5" colSpan={2}>סה״כ שולם</td>
                    <td className="border p-1.5 text-left">{money(totalPaid)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          <div className="border-t pt-3 text-sm space-y-1">
            <div className="flex justify-between"><span>חוב תיקונים למעבדה</span><span>{money(labDebt)}</span></div>
            <div className="flex justify-between"><span>בניכוי זיכויים</span><span>-{money(totalCredits)}</span></div>
            <div className="flex justify-between"><span>בניכוי תשלומים</span><span>-{money(totalPaid)}</span></div>
            <div className="flex justify-between font-bold text-base pt-1 border-t">
              <span>{balance >= 0 ? 'יתרה לתשלום למעבדה' : 'המעבדה חייבת לך'}</span>
              <span>{money(Math.abs(balance))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}