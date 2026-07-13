import React from 'react';

const fmt = (n) => `₪${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Display-only. Shows exactly how the lab-payment number is derived per repair.
// Formulas (unchanged): gross = fp − pc ; lab = pc + gross/2 ; net = fp − lab
export default function RepairCalcChain({ fp, pc, gross, lab, net }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
      <span className="text-blue-600 font-semibold">מחיר תיקון {fmt(fp)}</span>
      <span className="text-gray-400">−</span>
      <span className="text-red-600 font-semibold">עלות חלק {fmt(pc)}</span>
      <span className="text-gray-400">=</span>
      <span className="text-orange-600 font-semibold">רווח גולמי {fmt(gross)}</span>
      <span className="text-gray-400">→ ÷2 →</span>
      <span className="text-red-600 font-semibold">
        תשלום למעבדה {fmt(lab)}
        <span className="text-gray-400 font-normal"> (חלק מעבדה {fmt(gross / 2)} + עלות חלק {fmt(pc)})</span>
      </span>
      <span className="text-gray-400">|</span>
      <span className="text-green-600 font-semibold">חלק חנות = רווח נקי {fmt(net)}</span>
    </div>
  );
}