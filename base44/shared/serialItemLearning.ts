// serialItemLearning — shared logic: resolve which Linet item a physical serial belongs to
// (from the synced SerialInventory), and "teach" the system by updating the order serial
// line mapping + LinetProductMap so future orders auto-identify the item.
// Used by: updateOrderSerialLine (learning at selection time) and createSPLinetInvoice (invoice time).

/**
 * Resolves { linet_item_id, linet_sku, linet_item_name } from a list of serials
 * using the local SerialInventory (synced from Linet). Returns null if not found.
 */
export async function resolveItemFromSerials(base44, serials) {
  const list = (serials || []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) return null;
  let rows = [];
  try {
    rows = await base44.asServiceRole.entities.SerialInventory.filter({ serial: { $in: list } });
  } catch (_) {
    return null;
  }
  const row = (rows || []).find((r) => r.linet_item_id != null);
  if (!row) return null;
  return {
    linet_item_id: Number(row.linet_item_id),
    linet_sku: row.sku ?? null,
    linet_item_name: row.item_name ?? null,
  };
}

/**
 * Teaches the system: updates the serial line's mapped_linet_* fields when they are
 * missing or differ from what the physical serial says, and upserts LinetProductMap
 * (keyed by superpharm_sku for SP lines, sku for Woo lines) so the mapping persists.
 * Re-learns (overwrites) an existing mapping that points to a different item.
 */
export async function learnLineMapping(base44, { entityName = "OrderSerialLine", line, resolved }) {
  const result = { updated_line: false, updated_map: false };
  if (!resolved?.linet_item_id || !line?.id) return result;

  // 1. Update the order serial line mapping if missing/different
  if (Number(line.mapped_linet_item_id) !== Number(resolved.linet_item_id)) {
    const idValue = entityName === "OrderItemSerial"
      ? String(resolved.linet_item_id)
      : Number(resolved.linet_item_id);
    try {
      await base44.asServiceRole.entities[entityName].update(line.id, {
        mapped_linet_item_id: idValue,
        mapped_linet_sku: resolved.linet_sku ?? null,
        mapped_linet_item_name: resolved.linet_item_name ?? null,
      });
      result.updated_line = true;
    } catch (_) {}
  }

  // 2. Upsert LinetProductMap so future orders auto-identify the item
  const isSP = line.source === "superpharm";
  const srcSku = line.source_sku ? String(line.source_sku) : null;
  if (!srcSku) return result;

  let maps = [];
  try {
    maps = isSP
      ? await base44.asServiceRole.entities.LinetProductMap.filter({ superpharm_sku: srcSku })
      : await base44.asServiceRole.entities.LinetProductMap.filter({ sku: srcSku });
  } catch (_) {}

  const patch = {
    linet_item_id: Number(resolved.linet_item_id),
    linet_item_name: resolved.linet_item_name || "",
    linet_stock_type: 2,
    requires_serial: true,
    serial_source: isSP ? "manual_sp" : "manual_serial",
    last_checked: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: "serial-learning",
    ...(isSP ? { superpharm_sku: srcSku } : {}),
  };

  try {
    if (maps.length > 0) {
      const existing = maps[0];
      if (Number(existing.linet_item_id) !== Number(resolved.linet_item_id) || !existing.requires_serial) {
        await base44.asServiceRole.entities.LinetProductMap.update(existing.id, patch);
        result.updated_map = true;
      }
    } else {
      await base44.asServiceRole.entities.LinetProductMap.create({
        sku: isSP ? `sp_${srcSku}` : srcSku,
        ...patch,
      });
      result.updated_map = true;
    }
  } catch (_) {}

  return result;
}