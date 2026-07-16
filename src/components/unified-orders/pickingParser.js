// pickingParser.js
// Converts a unified order (WooCommerce line_items + EPO meta_data) into a clean
// physical picking list. Pure functions, no side effects.

// ── HTML entity + noise cleanup ─────────────────────────────────────────────
function decodeHtmlEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#8362;|₪/g, "₪");
}

// Remove price fragments like "(₪49.00)", "- 49₪", "49.00 ₪" from a label
function stripPrice(str) {
  if (!str) return "";
  return String(str)
    .replace(/\(?\s*[₪$]\s*[\d,.]+\s*\)?/g, " ")   // ₪49.00 / (₪49.00)
    .replace(/[\d,.]+\s*[₪$]/g, " ")               // 49.00₪
    .replace(/\s{2,}/g, " ")
    .replace(/[\s:–-]+$/g, "")
    .trim();
}

function clean(str) {
  return stripPrice(decodeHtmlEntities(str)).trim();
}

// Detect a leading quantity in EPO free text e.g. "הוסף 2 מגני מסך" → 2
function extractQtyFromText(text) {
  if (!text) return 1;
  const m = String(text).match(/(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 999) return n;
  }
  return 1;
}

// Non-physical add-ons that must NOT be picked
const NON_PHYSICAL_KEYWORDS = [
  "אחריות", "שירות", "התקנה", "חריטה", "הקדשה", "הערה", "הערת",
  "צבע", "שדרוג", "ביטוח", "warranty", "service", "installation",
  "engraving", "note", "color", "gift wrap", "עטיפת מתנה",
];

// Values that mean "customer chose NOT to add this" → not a physical item
const NEGATIVE_VALUES = ["ללא", "לא", "אין", "no", "none", "0"];

function isNegativeChoice(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return true;
  return NEGATIVE_VALUES.includes(v);
}

function isNonPhysical(label, value) {
  if (isNegativeChoice(value)) return true;
  const hay = `${label || ""} ${value || ""}`.toLowerCase();
  return NON_PHYSICAL_KEYWORDS.some((kw) => hay.includes(kw.toLowerCase()));
}

// Attribute keywords — customer choices that aren't a separate pickable item, but the
// picker MUST see them (e.g. a chosen color). Shown as tags on the parent product line.
const ATTRIBUTE_KEYWORDS = ["צבע", "color", "חריטה", "הקדשה", "engraving", "מידה", "size", "דגם"];

function isAttributeChoice(label, value) {
  if (isNegativeChoice(value)) return false; // "ללא" — nothing chosen
  const hay = `${label || ""} ${value || ""}`.toLowerCase();
  return ATTRIBUTE_KEYWORDS.some((kw) => hay.includes(kw.toLowerCase()));
}

// Physical accessory hints — used to give a nicer clean title when possible
function looksPhysical(label, value) {
  const hay = `${label || ""} ${value || ""}`.toLowerCase();
  const physical = [
    "מגן מסך", "כיסוי", "מטען", "כבל", "מתאם", "אוזניות",
    "כרטיס", "מארז", "case", "cover", "charger", "cable",
    "adapter", "screen", "protector", "earphone", "headphone",
  ];
  return physical.some((kw) => hay.includes(kw.toLowerCase()));
}

function parseMeta(metaStr) {
  if (!metaStr) return [];
  let meta;
  try { meta = typeof metaStr === "string" ? JSON.parse(metaStr) : metaStr; }
  catch { return []; }
  if (!Array.isArray(meta)) return [];
  return meta.filter((m) => {
    if (!m || !m.key || m.value == null) return false;
    if (typeof m.key !== "string") return false;
    if (m.key.startsWith("_")) return false;
    if (typeof m.value === "object") return false;
    return true;
  });
}

// Build the picking items for a single order (before merging)
function rawItemsFromOrder(order) {
  const orderId = order?.raw_id || order?.id || String(order?.order_number || "");
  const items = [];
  const products = order?.products || [];

  products.forEach((p, pIdx) => {
    const qty = Number(p.quantity) || 1;
    const title = clean(p.name) || "מוצר";
    const sku = p.sku ? String(p.sku) : null;

    // Main product — attributes (like chosen color) collected below and attached here
    const mainItem = {
      type: "main_product",
      title,
      sku,
      quantity: qty,
      source_line_item_id: `${orderId}_line_${pIdx}`,
      parent_product_name: null,
      source_label: null,
      raw_meta_json: p.meta_data || null,
      attributes: [],
    };
    items.push(mainItem);

    // EPO add-ons from meta_data
    const metas = parseMeta(p.meta_data);
    metas.forEach((m) => {
      const label = clean(m.display_key || m.key);
      const value = clean(m.display_value || m.value);
      if (!value && !label) return;

      // Customer-chosen attribute (e.g. color) — not a pickable item, but show it on the product
      if (isAttributeChoice(m.display_key || m.key, m.display_value || m.value)) {
        mainItem.attributes.push({ label: label || "בחירה", value: value || label });
        return;
      }

      if (isNonPhysical(m.display_key || m.key, m.display_value || m.value)) return;

      // Choose the cleanest physical name available
      let addonTitle = value || label;
      if (looksPhysical(label, "")) addonTitle = label;
      addonTitle = clean(addonTitle);
      if (!addonTitle) return;

      // Quantity: from the raw value text (e.g. "הוסף 2 מגני מסך"), multiplied by product qty
      const addonQty = extractQtyFromText(m.display_value || m.value) * qty;

      items.push({
        type: "epo_addon",
        title: addonTitle,
        sku: null,
        quantity: addonQty,
        source_line_item_id: `${orderId}_line_${pIdx}`,
        parent_product_name: title,
        source_label: "תוספת מוצר",
        raw_meta_json: JSON.stringify(m),
      });
    });
  });

  return { orderId, items };
}

// Merge identical items (same type + title + sku), summing quantities
function mergeItems(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${it.type}|${(it.title || "").toLowerCase()}|${it.sku || ""}`;
    if (map.has(key)) {
      const prev = map.get(key);
      prev.quantity += it.quantity;
    } else {
      map.set(key, { ...it });
    }
  }
  return Array.from(map.values());
}

export function buildPickingItemsFromOrder(order) {
  if (!order) return [];
  const { orderId, items } = rawItemsFromOrder(order);
  const merged = mergeItems(items);

  return merged.map((it, idx) => ({
    id: `${orderId}_pick_${idx}`,
    picking_item_id: `${orderId}_pick_${idx}`,
    order_id: orderId,
    type: it.type,
    title: it.title,
    sku: it.sku,
    quantity: it.quantity,
    source_line_item_id: it.source_line_item_id,
    parent_product_name: it.parent_product_name,
    source_label: it.source_label,
    attributes: it.attributes || [],
    raw_meta_json: it.raw_meta_json,
    picked: false,
    picked_by_user_id: null,
    picked_at: null,
  }));
}

export function totalPickingUnits(items) {
  return (items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
}

export function computePickingStatus(items) {
  if (!items || items.length === 0) return "completed"; // nothing to pick
  const pickedCount = items.filter((i) => i.picked).length;
  if (pickedCount === 0) return "not_started";
  if (pickedCount === items.length) return "completed";
  return "partial";
}