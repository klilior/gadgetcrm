import React from 'react';
import { reviewArithmetic, parseReviewJson } from '../../../base44/shared/invoiceReviewPolicy.ts';

export default function InvoiceReviewSummary({invoice,onChange}) {
  const check=reviewArithmetic(invoice);
  const extraction=parseReviewJson(invoice.ai_debug_last_extraction_json);
  const original=extraction.total_with_vat;
  const changed=original != null && Number(original)!==Number(invoice.total_with_vat);
  const evidence=extraction.amount_provenance;
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3" dir="rtl">
    <div className="text-sm font-semibold text-slate-600">הסכום שייכלל בהוצאות</div>
    <div className="text-3xl font-bold tabular-nums text-slate-900">{invoice.total_with_vat == null ? 'חסר סכום' : new Intl.NumberFormat('he-IL',{style:'currency',currency:invoice.currency || 'ILS'}).format(invoice.total_with_vat)}</div>
    <p className={check.ok?'text-sm text-emerald-700':'text-sm text-amber-800'}>{check.ok?'הסכום לפני מע״מ והמע״מ מסתכמים לסכום הכולל.':check.reason}</p>
    {evidence?.total_evidence_label && <p className="text-xs text-slate-600">הסכום זוהה ליד: {evidence.total_evidence_label}</p>}
    {invoice.validation_failures && <p className="text-sm text-amber-800">{invoice.validation_failures}</p>}
    {changed && <p className="text-xs text-slate-600">בחילוץ המקורי: {Number(original).toLocaleString('he-IL')} · הערך המתוקן יישמר בנפרד.</p>}
    <details open={changed} className="text-sm">
      <summary className="cursor-pointer font-medium">ללמד את המערכת מה לתקן</summary>
      <div className="space-y-2 pt-3">
        <label className="block text-xs text-slate-600">מה השתבש בקריאת הסכום?
          <select className="mt-1 w-full rounded-md border bg-white p-2" value={invoice._correctionReason || 'corrected_amount'} onChange={event=>onChange({...invoice,_correctionReason:event.target.value})}>
            <option value="corrected_amount">הסכום נקרא לא נכון</option>
            <option value="turnover_instead_of_fee">נבחר מחזור עסקאות במקום עמלה</option>
            <option value="vat_or_subtotal">בלבול בין סכום כולל, מע״מ וסכום לפני מע״מ</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">הכותרת ליד הסכום הנכון במסמך — אם ידועה
          <input className="mt-1 w-full rounded-md border bg-white p-2" maxLength={120} value={invoice._amountLabel || ''} onChange={event=>onChange({...invoice,_amountLabel:event.target.value})} placeholder="למשל: סה״כ עמלות כולל מע״מ" />
        </label>
        <p className="text-xs text-slate-500">הלמידה מכוונת לקריאה חוזרת מהמסמך הבא; היא אינה מעתיקה סכומים מהעבר.</p>
      </div>
    </details>
  </section>;
}
