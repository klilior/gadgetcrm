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
    // Cursor-based pagination for Woo (pass from previous response when has_more=true)
    const wooCursor = body.woo_cursor || null; // ISO date string
    const MAX_PER_CALL = 200; // max records to write per invocation
    const BATCH = 500;
    const MAX_PAGES = 50; // safety cap = 25,000 records

    console.log(`🔒 backfillOrderLocks — dry_run=${dryRun}, woo_cursor=${wooCursor}`);

    // ─── WooCommerce — cursor-based pagination ────────────────────────
    let wooTotal = 0;
    let wooUpdated = 0;
    let wooFailed = 0;
    const wooFailedIds = [];
    let wooHasMore = false;
    let wooNextCursor = null;
    let pagesScanned = 0;

    let cursorDate = wooCursor || null;

    while (true) {
      const filter = { status: 'completed', order_locked: { $ne: true } };
      if (cursorDate) filter['order_date'] = { $lt: cursorDate };

      const batch = await base44.asServiceRole.entities.Order.filter(
        filter,
        '-order_date',
        BATCH
      ).catch(() => []);

      if (batch.length === 0) break;
      wooTotal += batch.length;

      if (!dryRun) {
        // Chunk: process up to MAX_PER_CALL total across all batches this invocation
        const toProcess = batch.slice(0, MAX_PER_CALL - wooUpdated - wooFailed);
        if (toProcess.length === 0) {
          // Already hit limit — signal more work remains
          wooHasMore = true;
          wooNextCursor = cursorDate;
          break;
        }

        const results = await Promise.allSettled(
          toProcess.map(o =>
            base44.asServiceRole.entities.Order.update(o.id, {
              order_locked: true,
              shipment_created_at: 'historical',
            })
          )
        );

        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') {
            wooUpdated++;
          } else {
            wooFailed++;
            if (wooFailedIds.length < 20) wooFailedIds.push(toProcess[i].id);
            console.warn(`⚠️ Woo update failed ${toProcess[i].id}: ${results[i].reason?.message}`);
          }
        }

        // If we processed fewer than the batch size we need to continue with cursor
        if (wooUpdated + wooFailed >= MAX_PER_CALL) {
          // Check if there's more to do
          if (batch.length === BATCH) {
            wooHasMore = true;
            const lastInBatch = batch[batch.length - 1];
            wooNextCursor = lastInBatch.order_date || null;
          }
          break;
        }
      }

      // Advance cursor to last record's order_date
      if (batch.length < BATCH) break; // last page

      const last = batch[batch.length - 1];
      cursorDate = last.order_date || null;
      if (!cursorDate) break; // can't paginate without cursor

      pagesScanned++;
      if (pagesScanned >= MAX_PAGES) {
        if (!dryRun) { wooHasMore = true; wooNextCursor = cursorDate; }
        break;
      }
    }

    // ─── Mirakl / SuperPharmOrder ──────────────────────────────────
    let spTotal = 0;
    let spUpdated = 0;
    let spFailed = 0;
    const spFailedIds = [];

    const [spShipped, spReceived, spClosed] = await Promise.all([
      base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'SHIPPED', order_locked: { $ne: true } }, null, 1000).catch(() => []),
      base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'RECEIVED', order_locked: { $ne: true } }, null, 1000).catch(() => []),
      base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'CLOSED', order_locked: { $ne: true } }, null, 1000).catch(() => []),
    ]);

    const spMap = new Map();
    for (const o of [...spShipped, ...spReceived, ...spClosed]) spMap.set(o.id, o);
    spTotal = spMap.size;

    if (!dryRun) {
      const spArr = Array.from(spMap.values());
      const results = await Promise.allSettled(
        spArr.map(o =>
          base44.asServiceRole.entities.SuperPharmOrder.update(o.id, {
            order_locked: true,
            shipment_created_at: 'historical',
          })
        )
      );
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          spUpdated++;
        } else {
          spFailed++;
          if (spFailedIds.length < 20) spFailedIds.push(spArr[i].id);
          console.warn(`⚠️ SP update failed ${spArr[i].id}: ${results[i].reason?.message}`);
        }
      }
    }

    // ─── Linet (LinetOrderStatus) ──────────────────────────────────
    let linetTotal = 0;
    let linetUpdated = 0;
    let linetFailed = 0;
    const linetFailedIds = [];

    const linetDone = await base44.asServiceRole.entities.LinetOrderStatus.filter(
      { status: 'טופל', order_locked: { $ne: true } },
      null,
      500
    ).catch(() => []);
    linetTotal = linetDone.length;

    if (!dryRun) {
      const results = await Promise.allSettled(
        linetDone.map(o =>
          base44.asServiceRole.entities.LinetOrderStatus.update(o.id, {
            order_locked: true,
            shipment_created_at: 'historical',
          })
        )
      );
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          linetUpdated++;
        } else {
          linetFailed++;
          if (linetFailedIds.length < 20) linetFailedIds.push(linetDone[i].id);
          console.warn(`⚠️ Linet update failed ${linetDone[i].id}: ${results[i].reason?.message}`);
        }
      }
    }

    const summary = dryRun
      ? `[DRY RUN] would update ~${wooTotal} woo (cursor-based, one-page scan), ${spTotal} mirakl, ${linetTotal} linet`
      : `Updated: woo=${wooUpdated}/${wooUpdated+wooFailed}, sp=${spUpdated}/${spUpdated+spFailed}, linet=${linetUpdated}/${linetUpdated+linetFailed}`;
    console.log(`✅ ${summary}`);

    return Response.json({
      dry_run: dryRun,
      woo: dryRun
        ? { would_update_this_page: wooTotal }
        : { updated: wooUpdated, failed: wooFailed, failed_ids: wooFailedIds, has_more: wooHasMore, next_cursor: wooNextCursor },
      mirakl: dryRun
        ? { would_update: spTotal }
        : { updated: spUpdated, failed: spFailed, failed_ids: spFailedIds },
      linet: dryRun
        ? { would_update: linetTotal }
        : { updated: linetUpdated, failed: linetFailed, failed_ids: linetFailedIds },
      summary,
    });
  } catch (e) {
    console.error('backfillOrderLocks error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});