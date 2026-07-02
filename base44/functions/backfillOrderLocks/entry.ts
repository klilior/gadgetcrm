import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default: dry run

    console.log(`🔒 backfillOrderLocks — dry_run=${dryRun}`);

    // ─── WooCommerce ───────────────────────────────────────────────
    let wooPage = 0;
    let wooTotal = 0;
    let wooUpdated = 0;
    const BATCH = 500;

    while (true) {
      const batch = await base44.asServiceRole.entities.Order.filter(
        { status: 'completed', order_locked: { $ne: true } },
        '-order_date',
        BATCH
      ).catch(() => []);

      if (batch.length === 0) break;
      wooTotal += batch.length;

      if (!dryRun) {
        for (const o of batch) {
          const shipAt = o.shipment_created_at || o.tracking_number ? 'historical' : null;
          await base44.asServiceRole.entities.Order.update(o.id, {
            order_locked: true,
            shipment_created_at: shipAt || 'historical',
          }).catch(e => console.warn(`⚠️ Woo update failed ${o.id}: ${e.message}`));
        }
        wooUpdated += batch.length;
      }

      // If batch < BATCH we're done (last page)
      if (batch.length < BATCH) break;
      wooPage++;
      // Safety: max 10 pages = 5000 records
      if (wooPage >= 10) break;
    }

    // ─── Mirakl / SuperPharmOrder ──────────────────────────────────
    let spTotal = 0;
    let spUpdated = 0;

    const spShipped = await base44.asServiceRole.entities.SuperPharmOrder.filter(
      { order_state: 'SHIPPED', order_locked: { $ne: true } },
      null,
      1000
    ).catch(() => []);
    const spReceived = await base44.asServiceRole.entities.SuperPharmOrder.filter(
      { order_state: 'RECEIVED', order_locked: { $ne: true } },
      null,
      1000
    ).catch(() => []);
    const spClosed = await base44.asServiceRole.entities.SuperPharmOrder.filter(
      { order_state: 'CLOSED', order_locked: { $ne: true } },
      null,
      1000
    ).catch(() => []);

    // Deduplicate
    const spMap = new Map();
    for (const o of [...spShipped, ...spReceived, ...spClosed]) spMap.set(o.id, o);
    spTotal = spMap.size;

    if (!dryRun) {
      for (const o of spMap.values()) {
        const shipAt = o.shipped_at || 'historical';
        await base44.asServiceRole.entities.SuperPharmOrder.update(o.id, {
          order_locked: true,
          shipment_created_at: shipAt,
        }).catch(e => console.warn(`⚠️ SP update failed ${o.id}: ${e.message}`));
        spUpdated++;
      }
    }

    // ─── Linet (LinetOrderStatus) ──────────────────────────────────
    let linetTotal = 0;
    let linetUpdated = 0;

    const linetDone = await base44.asServiceRole.entities.LinetOrderStatus.filter(
      { status: 'טופל', order_locked: { $ne: true } },
      null,
      500
    ).catch(() => []);
    linetTotal = linetDone.length;

    if (!dryRun) {
      for (const o of linetDone) {
        await base44.asServiceRole.entities.LinetOrderStatus.update(o.id, {
          order_locked: true,
          shipment_created_at: 'historical',
        }).catch(e => console.warn(`⚠️ Linet update failed ${o.id}: ${e.message}`));
        linetUpdated++;
      }
    }

    const summary = `Backfill order_locked: ${dryRun ? '[DRY RUN] would update' : 'updated'} ${wooUpdated || wooTotal} woocommerce, ${spUpdated || spTotal} mirakl, ${linetUpdated || linetTotal} linet`;
    console.log(`✅ ${summary}`);

    return Response.json({
      dry_run: dryRun,
      woo: dryRun ? { would_update: wooTotal } : { updated: wooUpdated },
      mirakl: dryRun ? { would_update: spTotal } : { updated: spUpdated },
      linet: dryRun ? { would_update: linetTotal } : { updated: linetUpdated },
      summary,
    });
  } catch (e) {
    console.error('backfillOrderLocks error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});