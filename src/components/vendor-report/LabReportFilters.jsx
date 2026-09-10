import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Printer, RotateCcw } from 'lucide-react';

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs text-gray-500 mb-1">{label}</label>
    {children}
  </div>
);

const Toggle = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <Checkbox checked={checked} onCheckedChange={onChange} />
    {label}
  </label>
);

export default function LabReportFilters({ f, set, onReset, onPrint }) {
  return (
    <div className="bg-white border rounded-xl p-4 mb-6 print:hidden space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="מתאריך"><Input type="date" value={f.from} onChange={e => set({ from: e.target.value })} /></Field>
        <Field label="עד תאריך"><Input type="date" value={f.to} onChange={e => set({ to: e.target.value })} /></Field>
        <Field label="חיפוש לקוח"><Input value={f.client} onChange={e => set({ client: e.target.value })} placeholder="שם לקוח" /></Field>
        <Field label="חיפוש מכשיר / תקלה"><Input value={f.device} onChange={e => set({ device: e.target.value })} placeholder="דגם או תקלה" /></Field>
        <Field label="מס׳ תיקון"><Input value={f.repairId} onChange={e => set({ repairId: e.target.value })} placeholder="לדוגמה 71011" /></Field>
        <Field label="הכנסה מ-₪"><Input type="number" value={f.minPrice} onChange={e => set({ minPrice: e.target.value })} /></Field>
        <Field label="הכנסה עד ₪"><Input type="number" value={f.maxPrice} onChange={e => set({ maxPrice: e.target.value })} /></Field>
        <Field label="מי לקח (זיכויים)"><Input value={f.takenBy} onChange={e => set({ takenBy: e.target.value })} placeholder="שם עובד" /></Field>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 border-t">
        <Toggle label="תיקונים" checked={f.showRepairs} onChange={v => set({ showRepairs: !!v })} />
        <Toggle label="זיכויים (מוצרים שנלקחו)" checked={f.showCredits} onChange={v => set({ showCredits: !!v })} />
        <Toggle label="תשלומים" checked={f.showPayments} onChange={v => set({ showPayments: !!v })} />
        <Toggle label="רק תיקונים עם עלות חלק" checked={f.onlyWithPartCost} onChange={v => set({ onlyWithPartCost: !!v })} />
        <Toggle label="סיכום בלבד (בלי טבלאות)" checked={f.summaryOnly} onChange={v => set({ summaryOnly: !!v })} />
      </div>

      <div className="flex gap-2">
        <Button onClick={onPrint} className="gap-2 bg-purple-700 hover:bg-purple-800">
          <Printer className="w-4 h-4" /> הפקת דוח / הדפסה
        </Button>
        <Button variant="outline" onClick={onReset} className="gap-2">
          <RotateCcw className="w-4 h-4" /> איפוס סינון
        </Button>
      </div>
    </div>
  );
}