// markAsSerial.js — shared "teach the system" logic: mark a product as serial-required.
// Used by both the PickingList (unified flow) and SerialHandlingZone (locked orders).
import { base44 } from "@/api/base44Client";

/**
 * Marks a product as serial-required in LinetProductMap (persists for future orders)
 * and ensures an OrderSerialLine exists for the current order.
 * Returns the OrderSerialLine (existing or newly created).
 */
export async function markProductAsSerial({ order, orderId, product, existingLines = [] }) {
  const sku = product.sku || String(product.product_id || "");
  if (!sku) throw new Error('אין מק"ט לסימון');

  const isSuperPharm = order.source === "mirakl" || order.source === "superpharm";

  // חיפוש לפי superpharm_sku (SP) או sku (Woo) — עקבי עם linkOrderLineToLinetItem
  const maps = isSuperPharm
    ? await base44.entities.LinetProductMap.filter({ superpharm_sku: sku }).catch(() => [])
    : await base44.entities.LinetProductMap.filter({ sku }).catch(() => []);

  const mapData = {
    requires_serial: true,
    linet_stock_type: 2,
    manual_override: true,
    serial_source: isSuperPharm ? "manual_sp" : "manual_serial",
    updated_at: new Date().toISOString(),
    ...(isSuperPharm ? { superpharm_sku: sku } : {}),
  };

  if (maps.length > 0) {
    await base44.entities.LinetProductMap.update(maps[0].id, mapData);
  } else {
    await base44.entities.LinetProductMap.create({
      sku: isSuperPharm ? `sp_${sku}` : sku, // sp_S###### — עקבי עם linkOrderLineToLinetItem
      ...mapData,
      linet_item_name: product.name || "",
    });
  }

  const itemId = `${orderId}_${sku}`;
  const existing = existingLines.find((l) => l.source_sku === sku || l.order_item_id === itemId);
  if (existing) return existing;

  return await base44.entities.OrderSerialLine.create({
    order_id: orderId,
    order_item_id: itemId,
    source: isSuperPharm ? "superpharm" : "woo",
    source_sku: sku,
    source_product_name: product.name || "",
    requires_serial: true,
    serials_required_count: product.quantity || 1,
    serial_status: "required_missing",
    assigned_serials: [],
  });
}

/**
 * Auto-create OrderSerialLine records for products the system already knows are
 * serial-required (taught previously via LinetProductMap) but have no line on
 * this order yet. Includes the Linet mapping so the serial picker opens directly.
 * Returns the newly created lines.
 */
export async function ensureSerialLinesFromCatalog({ order, orderId, items, existingLines = [] }) {
  const isSuperPharm = order?.source === "mirakl" || order?.source === "superpharm";
  const created = [];

  for (const item of items || []) {
    const sku = item.sku ? String(item.sku) : "";
    if (!sku) continue;
    if (existingLines.some((l) => String(l.source_sku || "") === sku)) continue;
    if (created.some((l) => String(l.source_sku || "") === sku)) continue;

    const maps = isSuperPharm
      ? await base44.entities.LinetProductMap.filter({ superpharm_sku: sku }).catch(() => [])
      : await base44.entities.LinetProductMap.filter({ sku }).catch(() => []);
    const map = maps.find((m) => m.requires_serial === true);
    if (!map) continue;

    // Guard against a race: another panel may have created the line meanwhile
    const itemId = `${orderId}_${sku}`;
    const dup = await base44.entities.OrderSerialLine.filter({ order_item_id: itemId }).catch(() => []);
    if (dup.length > 0) { created.push(dup[0]); continue; }

    const line = await base44.entities.OrderSerialLine.create({
      order_id: orderId,
      order_item_id: itemId,
      source: isSuperPharm ? "superpharm" : "woo",
      source_sku: sku,
      source_product_name: item.title || item.name || "",
      mapped_linet_item_id: map.linet_item_id != null ? Number(map.linet_item_id) : null,
      mapped_linet_sku: map.sku && !String(map.sku).startsWith("sp_") ? map.sku : null,
      mapped_linet_item_name: map.linet_item_name || null,
      requires_serial: true,
      serials_required_count: Number(item.quantity) || 1,
      serial_status: "required_missing",
      assigned_serials: [],
    });
    created.push(line);
  }

  return created;
}