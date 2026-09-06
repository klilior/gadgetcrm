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

// Detect an EXPLICIT quantity in EPO free text e.g. "הוסף 2 מגני מסך", "כמות: 3", "x2".
// Any other number in the text (price, "9 שכבות", model numbers) is NOT a quantity → 1.
function extractQtyFromText(text) {
  if (!text) return 1;
  const t = stripPrice(decodeHtmlEntities(String(text)).replace(/<[^>]*>/g, " "));
  const patterns = [
    /(?:הוסף|הוספת|כמות|יחידות|qty|quantity)\s*:?\s*(\d{1,2})(?!\d)/i,
    /(?:^|\s)[xX×]\s*(\d{1,2})(?!\d)/,
    /(\d{1,2})\s*[xX×](?:\s|$)/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n <= 20) return n;
    }
  }
  return 1;
}

// Services / notes — never packed, even when the customer paid for them
const NON_PHYSICAL_KEYWORDS = [
  "אחריות", "שירות", "התקנה", "חריטה", "הקדשה", "הערה", "הערת",
  "ביטוח", "warranty", "service", "installation",
  "engraving", "note", "gift wrap", "עטיפת מתנה",
];

// Values that mean "customer chose NOT to add this" → not a physical item
const NEGATIVE_VALUES = ["ללא", "לא", "אין", "no", "none", "0"];
const PLACEHOLDER_VALUES = ["בחר ראש טעינה", "בחר מטען", "בחר אפשרות", "יש לבחור"];

function isNegativeChoice(value) {
  const v = clean(value).trim().toLowerCase();
  if (!v) return true;
  return NEGATIVE_VALUES.includes(v) || PLACEHOLDER_VALUES.some((text) => v.startsWith(text));
}

function extractPrice(value) {
  const decoded = decodeHtmlEntities(value).replace(/<[^>]*>/g, " ");
  const match = decoded.match(/(?:₪\s*([\d,.]+)|([\d,.]+)\s*₪)/);
  if (!match) return null;
  const price = Number(String(match[1] || match[2]).replace(/,/g, ""));
  return Number.isFinite(price) ? price : null;
}

function isNonPhysical(label, value) {
  if (isNegativeChoice(value)) return true;
  const hay = `${label || ""} ${value || ""}`.toLowerCase();
  return NON_PHYSICAL_KEYWORDS.some((kw) => hay.includes(kw.toLowerCase()));
}

// Attribute keywords — customer choices that aren't a separate pickable item, but the
// picker MUST see them (e.g. a chosen color). Shown as tags on the parent product line.
const ATTRIBUTE_KEYWORDS = ["צבע", "color", "חריטה", "הקדשה", "engraving", "מידה", "size", "דגם"];

// שדה שהכותרת שלו היא בחירת מאפיין (צבע/מידה/דגם/חריטה) הוא תמיד מאפיין של המוצר האב,
// גם כשהכותרת מזכירה את שם המוצר עצמו (למשל "בחר צבע כיסוי ארנק" → "כחול").
function isAttributeLabel(label) {
  const text = `${label || ""}`.toLowerCase();
  return ATTRIBUTE_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

function isAttributeChoice(label, value) {
  if (isNegativeChoice(value)) return false; // "ללא" — nothing chosen
  // בחירת מאפיין ללא תוספת מחיר — מוצגת כתג על שורת המוצר, לא כפריט נפרד.
  if (isAttributeLabel(label) && extractPrice(value) === null) return true;
  // תוספת פיזית שנבחרה (למשל "כיסוי קומבו במגוון צבעים ₪99") אינה מאפיין —
  // היא פריט שצריך להיאסף, גם אם הטקסט מזכיר צבע/מידה.
  if (looksPhysical(label, value) || extractPrice(value) !== null) return false;
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

      // לא נוסף ע"י הלקוח / שירות בלבד — לא מוצג כלל
      if (isNonPhysical(m.display_key || m.key, m.display_value || m.value)) return;

      // Customer-chosen attribute (e.g. color) — not a pickable item, but show it on the product
      if (isAttributeChoice(m.display_key || m.key, m.display_value || m.value)) {
        mainItem.attributes.push({ label: label || "בחירה", value: value || label });
        return;
      }

      // Prefer the specific selected product (e.g. "כיסוי ארנק") over a generic field label.
      let addonTitle = looksPhysical("", value) ? value : (looksPhysical(label, "") ? label : (value || label));
      addonTitle = clean(addonTitle);
      if (!addonTitle) return;

      // Quantity: from the raw value text (e.g. "הוסף 2 מגני מסך"), multiplied by product qty
      const addonQty = extractQtyFromText(m.display_value || m.value) * qty;
      const addonPrice = extractPrice(m.display_value || m.value);

      items.push({
        type: "epo_addon",
        title: addonTitle,
        sku: null,
        quantity: addonQty,
        addon_price: addonPrice,
        source_line_item_id: `${orderId}_line_${pIdx}`,
        parent_product_name: title,
        source_label: "תוספת מוצר",
        raw_meta_json: JSON.stringify(m),
      });
    });
  });

  return { orderId, items };
}

// Signature of the customer-chosen attributes (e.g. color) — lines with different
// choices must stay separate even when they share the same product/SKU.
function attributesKey(it) {
  return (it.attributes || [])
    .map((a) => `${(a.label || "").toLowerCase()}=${(a.value || "").toLowerCase()}`)
    .sort()
    .join(";");
}

// Merge identical items (same type + title + sku + chosen attributes), summing quantities
function mergeItems(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${it.type}|${(it.title || "").toLowerCase()}|${it.sku || ""}|${attributesKey(it)}`;
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
    addon_price: it.addon_price ?? null,
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