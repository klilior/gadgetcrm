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