import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// ── Picking parser (inlined — mirrors src/components/unified-orders/pickingParser.js) ──
function decodeHtmlEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"');
}
function stripPrice(str) {
  if (!str) return "";
  return String(str)
    .replace(/\(?\s*[₪$]\s*[\d,.]+\s*\)?/g, " ")
    .replace(/[\d,.]+\s*[₪$]/g, " ")
    .replace(/\s{2,}/g, " ").replace(/[\s:–-]+$/g, "").trim();
}
function clean(str) { return stripPrice(decodeHtmlEntities(str)).trim(); }
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
    if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > 0 && n <= 20) return n; }
  }
  return 1;
}
function extractPrice(value) {
  const decoded = decodeHtmlEntities(value).replace(/<[^>]*>/g, " ");
  const match = decoded.match(/(?:₪\s*([\d,.]+)|([\d,.]+)\s*₪)/);
  if (!match) return null;
  const price = Number(String(match[1] || match[2]).replace(/,/g, ""));
  return Number.isFinite(price) ? price : null;
}
const ATTRIBUTE_KEYWORDS = ["צבע", "color", "חריטה", "הקדשה", "engraving", "מידה", "size", "דגם"];
function isAttributeChoice(label, value) {
  if (isNegativeChoice(value)) return false;
  if (looksPhysical(label, value) || extractPrice(value) !== null) return false;
  const hay = `${label || ""} ${value || ""}`.toLowerCase();
  return ATTRIBUTE_KEYWORDS.some((kw) => hay.includes(kw.toLowerCase()));
}
const NON_PHYSICAL_KEYWORDS = ["אחריות","שירות","התקנה","חריטה","הקדשה","הערה","הערת","ביטוח","warranty","service","installation","engraving","note","gift wrap","עטיפת מתנה"];
const NEGATIVE_VALUES = ["ללא", "לא", "אין", "no", "none", "0"];
const PLACEHOLDER_VALUES = ["בחר ראש טעינה", "בחר מטען", "בחר אפשרות", "יש לבחור"];
function isNegativeChoice(value) {
  const v = clean(value).trim().toLowerCase();
  if (!v) return true;
  return NEGATIVE_VALUES.includes(v) || PLACEHOLDER_VALUES.some((t) => v.startsWith(t));
}
function isNonPhysical(label, value) {
  if (isNegativeChoice(value)) return true;
  const hay = `${label || ""} ${value || ""}`.toLowerCase();
  return NON_PHYSICAL_KEYWORDS.some((kw) => hay.includes(kw.toLowerCase()));
}
function looksPhysical(label, value) {
  const hay = `${label || ""} ${value || ""}`.toLowerCase();
  const physical = ["מגן מסך","כיסוי","מטען","כבל","מתאם","אוזניות","כרטיס","מארז","case","cover","charger","cable","adapter","screen","protector","earphone","headphone"];
  return physical.some((kw) => hay.includes(kw.toLowerCase()));
}
function parseMeta(metaStr) {
  if (!metaStr) return [];
  let meta;
  try { meta = typeof metaStr === "string" ? JSON.parse(metaStr) : metaStr; } catch { return []; }
  if (!Array.isArray(meta)) return [];
  return meta.filter((m) => m && m.key && m.value != null && typeof m.key === "string" && !m.key.startsWith("_") && typeof m.value !== "object");
}
function buildPickingItemsFromOrder(order) {
  const orderId = order?.raw_id || order?.id || String(order?.order_number || "");
  const items = [];
  (order?.products || []).forEach((p, pIdx) => {
    const qty = Number(p.quantity) || 1;
    const title = clean(p.name) || "מוצר";
    items.push({ type: "main_product", title, sku: p.sku ? String(p.sku) : null, quantity: qty });
    parseMeta(p.meta_data).forEach((m) => {
      const label = clean(m.display_key || m.key);
      const value = clean(m.display_value || m.value);
      if (!value && !label) return;
      if (isNonPhysical(m.display_key || m.key, m.display_value || m.value)) return;
      if (isAttributeChoice(m.display_key || m.key, m.display_value || m.value)) return;
      let addonTitle = looksPhysical("", value) ? value : (looksPhysical(label, "") ? label : (value || label));
      addonTitle = clean(addonTitle);
      if (!addonTitle) return;
      const addonQty = extractQtyFromText(m.display_value || m.value) * qty;
      items.push({ type: "epo_addon", title: addonTitle, sku: null, quantity: addonQty });
    });
  });
  // merge identical
  const map = new Map();
  for (const it of items) {
    const key = `${it.type}|${(it.title || "").toLowerCase()}|${it.sku || ""}`;
    if (map.has(key)) map.get(key).quantity += it.quantity;
    else map.set(key, { ...it });
  }
  const merged = Array.from(map.values());
  return merged.map((it, idx) => ({ picking_item_id: `${orderId}_pick_${idx}`, ...it }));
}

/**
 * checkPickingGate — READ-ONLY
 * input: { order_id }  (internal Order raw_id)
 * output: { blocked, picking_status, total_items, picked_items, message_he }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return Response.json({ blocked: true, message_he: "לא סופק מזהה הזמנה." }, { status: 400 });
    }

    // Load the order (WooCommerce Order only — other sources are not gated here)
    let order = null;
    try { order = await base44.asServiceRole.entities.Order.get(String(order_id)); } catch (_) {}

    if (!order) {
      // Not a WooCommerce order → picking gate does not apply
      return Response.json({ blocked: false, picking_status: "completed", total_items: 0, picked_items: 0, message_he: "" });
    }

    // Attach products so the parser can run
    let products = [];
    try {
      products = await base44.asServiceRole.entities.OrderProduct.filter({ order_id: String(order_id) });
    } catch (_) {}
    const SHIPPING_UPSELL_SKU = '180948';
    products = (products || []).filter((x) => String(x.sku || '') !== SHIPPING_UPSELL_SKU && String(x.product_id ?? '') !== SHIPPING_UPSELL_SKU);

    if (products.length === 0) {
      return Response.json({ blocked: false, picking_status: "completed", total_items: 0, picked_items: 0, message_he: "" });
    }

    // מקור האמת: רשומות הליקוט שהנציג יצר במסך (PickingState).
    // כך אין שני פרסרים שיכולים לא להסכים על מספר הפריטים.
    let picks = [];
    try { picks = await base44.asServiceRole.entities.PickingState.filter({ order_id: String(order_id) }); } catch (_) {}

    const totalItems = picks.length;
    const pickedItems = picks.filter((p) => p.picked).length;
    // נדרש לפחות פריט אחד לכל שורת מוצר בהזמנה — כדי שהזמנה שלא נפתחה כלל לא תעבור
    const enoughRows = totalItems >= products.length;
    const allPicked = totalItems > 0 && pickedItems === totalItems && enoughRows;

    if (!allPicked) {
      return Response.json({
        blocked: true,
        picking_status: pickedItems === 0 ? "not_started" : "partial",
        total_items: Math.max(totalItems, products.length),
        picked_items: pickedItems,
        message_he: "לא ניתן ליצור משלוח לפני השלמת ליקוט.",
      });
    }

    return Response.json({ blocked: false, picking_status: "completed", total_items: totalItems, picked_items: pickedItems, message_he: "" });
  } catch (err) {
    return Response.json({ blocked: true, message_he: `שגיאה בבדיקת שער הליקוט: ${err.message}` }, { status: 500 });
  }
});