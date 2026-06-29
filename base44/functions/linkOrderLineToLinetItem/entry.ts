import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * linkOrderLineToLinetItem
 * קלט: { line_id, linet_item_id, linet_item_name, linet_sku, also_assign_serial? }
 * פעולה: מעדכן OrderSerialLine עם המיפוי, ואופציונלית מוסיף סריאלי.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { line_id, linet_item_id, linet_item_name, linet_sku, also_assign_serial } = body;

    if (!line_id || !linet_item_id) {
      return Response.json({ error: "line_id ו-linet_item_id נדרשים" }, { status: 400 });
    }

    // קרא את השורה הנוכחית כדי לשמור serials קיימים
    const current = await base44.asServiceRole.entities.OrderSerialLine.get(line_id);

    // ── למידה: אם מקור = superpharm, שמור את SP SKU ב-LinetProductMap ──
    if (current?.source === 'superpharm' && current?.source_sku) {
      const spSku = current.source_sku;
      try {
        const existing = await base44.asServiceRole.entities.LinetProductMap.filter({ superpharm_sku: spSku }, null, 1);
        const mapData = {
          superpharm_sku: spSku,
          linet_item_id: Number(linet_item_id),
          linet_item_name: linet_item_name ?? null,
          linet_stock_type: 2,
          requires_serial: true,
          serial_source: 'manual_sp',
          manual_override: true,
          updated_at: new Date().toISOString(),
        };
        if (existing.length > 0) {
          await base44.asServiceRole.entities.LinetProductMap.update(existing[0].id, mapData);
          console.log(`[linkOrderLine] Updated SP mapping: superpharm_sku=${spSku} → linet_item_id=${linet_item_id}`);
        } else {
          // sku שדה חובה — שים את SP SKU שם גם (ייחודי בתוך LinetProductMap)
          await base44.asServiceRole.entities.LinetProductMap.create({ ...mapData, sku: spSku });
          console.log(`[linkOrderLine] Created SP mapping: superpharm_sku=${spSku} → linet_item_id=${linet_item_id}`);
        }
      } catch (spErr) {
        console.warn(`[linkOrderLine] Failed to save SP mapping (non-critical): ${spErr.message}`);
      }
    }

    const currentSerials = Array.isArray(current?.assigned_serials) ? current.assigned_serials : [];
    const newSerials = also_assign_serial && !currentSerials.includes(also_assign_serial)
      ? [...currentSerials, also_assign_serial]
      : currentSerials;

    const required = current?.serials_required_count ?? 1;
    const newStatus = newSerials.length >= required ? "selected" : "required_missing";

    await base44.asServiceRole.entities.OrderSerialLine.update(line_id, {
      mapped_linet_item_id: Number(linet_item_id),
      mapped_linet_item_name: linet_item_name ?? null,
      mapped_linet_sku: linet_sku ?? null,
      requires_serial: true,
      assigned_serials: newSerials,
      serial_status: newStatus,
    });

    return Response.json({ ok: true, assigned_serials: newSerials, serial_status: newStatus });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});