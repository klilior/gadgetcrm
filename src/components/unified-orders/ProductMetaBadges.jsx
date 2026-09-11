import React from "react";

// ערכים שמשמעותם "הלקוח לא בחר תוספת" — לא מוצגים כלל
const EMPTY_VALUES = ["ללא", "בלי", "אין", "לא", "none", "no", "-", "0", "false"];

function isEmptyChoice(value) {
  const v = String(value).trim().toLowerCase().replace(/^ללא\s.*$/, "ללא");
  return EMPTY_VALUES.includes(v) || v === "" || v.startsWith("ללא");
}

// Parse WooCommerce line item meta_data and return display-friendly options
function parseMetaData(metaStr) {
  if (!metaStr) return [];
  let meta;
  try { meta = JSON.parse(metaStr); } catch { return []; }
  if (!Array.isArray(meta)) return [];

  return meta.filter(m => {
    if (!m.key || !m.value) return false;
    if (typeof m.key !== 'string') return false;
    if (m.key.startsWith('_')) return false;
    if (['Composite Products', 'tm_epo_product_original_price'].includes(m.key)) return false;
    if (typeof m.value === 'object') return false;
    if (isEmptyChoice(m.display_value ?? m.value)) return false;
    return true;
  }).map(m => ({
    label: String(m.display_key || m.key),
    value: String(m.display_value || m.value),
  }));
}

export default function ProductMetaBadges({ metaData }) {
  const options = parseMetaData(metaData);
  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {options.map((opt, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 bg-gray-50 text-gray-600 border border-gray-200 rounded-md px-1.5 py-0.5 text-[10px]"
        >
          <span className="text-gray-400">{opt.label}</span>
          <span className="font-medium text-gray-700">{opt.value}</span>
        </span>
      ))}
    </div>
  );
}