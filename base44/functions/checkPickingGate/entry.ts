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
  const m = String(text).match(/(\d+)/);
  if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > 0 && n <= 999) return n; }
  return 1;
}
const NON_PHYSICAL_KEYWORDS = ["אחריות","שירות","התקנה","חריטה","הקדשה","הערה","הערת","צבע","שדרוג","ביטוח","warranty","service","installation","engraving","note","color","gift wrap","עטיפת מתנה"];
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
function looksPhysical(label) {
  const hay = `${label || ""}`.toLowerCase();
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
      let addonTitle = value || label;
      if (looksPhysical(label)) addonTitle = label;
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

    const orderForParser = {
      raw_id: order.id,
      products: products.map((x) => ({ name: x.name || '', sku: x.sku || (x.product_id != null ? String(x.product_id) : ''), quantity: x.quantity || 1, meta_data: x.meta_data || '' })),
    };

    const items = buildPickingItemsFromOrder(orderForParser);

    if (items.length === 0) {
      return Response.json({ blocked: false, picking_status: "completed", total_items: 0, picked_items: 0, message_he: "" });
    }

    // Load saved picks
    let picks = [];
    try { picks = await base44.asServiceRole.entities.PickingState.filter({ order_id: String(order_id) }); } catch (_) {}
    const pickedSet = new Set(picks.filter((p) => p.picked).map((p) => p.picking_item_id));

    const pickedItems = items.filter((it) => pickedSet.has(it.picking_item_id)).length;
    const allPicked = pickedItems === items.length;

    if (!allPicked) {
      return Response.json({
        blocked: true,
        picking_status: pickedItems === 0 ? "not_started" : "partial",
        total_items: items.length,
        picked_items: pickedItems,
        message_he: "לא ניתן ליצור משלוח לפני השלמת ליקוט.",
      });
    }

    return Response.json({ blocked: false, picking_status: "completed", total_items: items.length, picked_items: pickedItems, message_he: "" });
  } catch (err) {
    return Response.json({ blocked: true, message_he: `שגיאה בבדיקת שער הליקוט: ${err.message}` }, { status: 500 });
  }
});