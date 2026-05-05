import React from "react";

// Parse WooCommerce line item meta_data and return display-friendly options
function parseMetaData(metaStr) {
  if (!metaStr) return [];
  let meta;
  try { meta = JSON.parse(metaStr); } catch { return []; }
  if (!Array.isArray(meta)) return [];

  // Filter out internal WooCommerce keys (start with _ or are system fields)
  return meta.filter(m => {
    if (!m.key || !m.value) return false;
    if (typeof m.key !== 'string') return false;
    // Skip internal/system meta keys
    if (m.key.startsWith('_')) return false;
    if (['Composite Products', 'tm_epo_product_original_price'].includes(m.key)) return false;
    // Skip if value is object/array (not user-facing)
    if (typeof m.value === 'object') return false;
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
    <div className="flex flex-wrap gap-1 mt-0.5">
      {options.map((opt, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md px-1.5 py-0.5 text-[10px]"
        >
          <span className="font-semibold">{opt.label}:</span>
          <span>{opt.value}</span>
        </span>
      ))}
    </div>
  );
}