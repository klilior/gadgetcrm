import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Helper: split array into chunks of given size
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
    const CHUNK_SIZE = 100; // concurrency limit for SP and Linet

    // Unique run_id for rollback tracking (ISO timestamp, same across the whole invocation)
    const runId = body.run_id || new Date().toISOString();

    console.log(`🔒 backfillOrderLocks — dry_run=${dryRun}, woo_cursor=${wooCursor}, run_id=${runId}`);

    // ─── WooCommerce — cursor-based pagination ────────────────────────
    let wooTotal = 0;
    let wooUpdated = 0;
    let wooFailed = 0;
    const wooFailedIds = [];
    let wooLogFailed = 0;
    const wooLogFailedIds = [];
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
          toProcess.map(async (o) => {
            await base44.asServiceRole.entities.Order.update(o.id, {
              order_locked: true,
              shipment_created_at: 'historical',
            });
            let logOk = true;
            try {
              await base44.asServiceRole.entities.BackfillRunLog.create({
                run_id: runId,
                order_id: o.id,
                source: 'woocommerce',
                entity_name: 'Order',
                previous_order_locked: o.order_locked || false,
                previous_shipment_created_at: o.shipment_created_at || null,
              });
            } catch (logErr) {
              logOk = false;
              console.warn(`⚠️ BackfillRunLog write failed for woo/${o.id}: ${logErr.message}`);
            }
            return { logOk, orderId: o.id };
          })
        );

        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') {
            wooUpdated++;
            if (!results[i].value.logOk) {
              wooLogFailed++;
              if (wooLogFailedIds.length < 20) wooLogFailedIds.push(results[i].value.orderId);
            }
          } else {
            wooFailed++;
            if (wooFailedIds.length < 20) wooFailedIds.push(toProcess[i].id);
            console.warn(`⚠️ Woo update failed ${toProcess[i].id}: ${results[i].reason?.message}`);
          }
        }

        // FIX: cursor based on last record actually processed, not last record fetched
        if (wooUpdated + wooFailed >= MAX_PER_CALL) {
          if (batch.length === BATCH) {
            wooHasMore = true;
            const lastProcessed = toProcess[toProcess.length - 1];
            wooNextCursor = lastProcessed?.order_date || null;
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

    // ─── Mirakl / SuperPharmOrder ─────────────────────────────────────
    let spTotal = 0;
    let spUpdated = 0;
    let spFailed = 0;
    const spFailedIds = [];
    let spLogFailed = 0;
    const spLogFailedIds = [];

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
      const spChunks = chunk(spArr, CHUNK_SIZE);
      for (const ch of spChunks) {
        const results = await Promise.allSettled(
          ch.map(async (o) => {
            await base44.asServiceRole.entities.SuperPharmOrder.update(o.id, {
              order_locked: true,
              shipment_created_at: 'historical',
            });
            let logOk = true;
            try {
              await base44.asServiceRole.entities.BackfillRunLog.create({
                run_id: runId,
                order_id: o.id,
                source: 'mirakl',
                entity_name: 'SuperPharmOrder',
                previous_order_locked: o.order_locked || false,
                previous_shipment_created_at: o.shipment_created_at || null,
              });
            } catch (logErr) {
              logOk = false;
              console.warn(`⚠️ BackfillRunLog write failed for sp/${o.id}: ${logErr.message}`);
            }
            return { logOk, orderId: o.id };
          })
        );
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') {
            spUpdated++;
            if (!results[i].value.logOk) {
              spLogFailed++;
              if (spLogFailedIds.length < 20) spLogFailedIds.push(results[i].value.orderId);
            }
          } else {
            spFailed++;
            if (spFailedIds.length < 20) spFailedIds.push(ch[i].id);
            console.warn(`⚠️ SP update failed ${ch[i].id}: ${results[i].reason?.message}`);
          }
        }
      }
    }

    // ─── Linet (LinetOrderStatus) ──────────────────────────────────────
    let linetTotal = 0;
    let linetUpdated = 0;
    let linetFailed = 0;
    const linetFailedIds = [];
    let linetLogFailed = 0;
    const linetLogFailedIds = [];

    const linetDone = await base44.asServiceRole.entities.LinetOrderStatus.filter(
      { status: 'טופל', order_locked: { $ne: true } },
      null,
      500
    ).catch(() => []);
    linetTotal = linetDone.length;

    if (!dryRun) {
      const linetChunks = chunk(linetDone, CHUNK_SIZE);
      for (const ch of linetChunks) {
        const results = await Promise.allSettled(
          ch.map(async (o) => {
            await base44.asServiceRole.entities.LinetOrderStatus.update(o.id, {
              order_locked: true,
              shipment_created_at: 'historical',
            });
            let logOk = true;
            try {
              await base44.asServiceRole.entities.BackfillRunLog.create({
                run_id: runId,
                order_id: o.id,
                source: 'linet',
                entity_name: 'LinetOrderStatus',
                previous_order_locked: o.order_locked || false,
                previous_shipment_created_at: o.shipment_created_at || null,
              });
            } catch (logErr) {
              logOk = false;
              console.warn(`⚠️ BackfillRunLog write failed for linet/${o.id}: ${logErr.message}`);
            }
            return { logOk, orderId: o.id };
          })
        );
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') {
            linetUpdated++;
            if (!results[i].value.logOk) {
              linetLogFailed++;
              if (linetLogFailedIds.length < 20) linetLogFailedIds.push(results[i].value.orderId);
            }
          } else {
            linetFailed++;
            if (linetFailedIds.length < 20) linetFailedIds.push(ch[i].id);
            console.warn(`⚠️ Linet update failed ${ch[i].id}: ${results[i].reason?.message}`);
          }
        }
      }
    }

    const totalLogFailed = wooLogFailed + spLogFailed + linetLogFailed;
    const summary = dryRun
      ? `[DRY RUN] would update ~${wooTotal} woo (this page), ${spTotal} mirakl, ${linetTotal} linet`
      : `Updated: woo=${wooUpdated}/${wooUpdated+wooFailed}, sp=${spUpdated}/${spUpdated+spFailed}, linet=${linetUpdated}/${linetUpdated+linetFailed}`;
    console.log(`✅ ${summary}`);
    if (!dryRun && totalLogFailed > 0) {
      console.warn(`🚨 ROLLBACK COVERAGE GAP: ${totalLogFailed} orders locked WITHOUT a BackfillRunLog entry — woo:${wooLogFailed} sp:${spLogFailed} linet:${linetLogFailed}. These IDs cannot be undone via undoBackfillRun!`);
    }

    return Response.json({
      dry_run: dryRun,
      run_id: runId,
      woo: dryRun
        ? { would_update_this_page: wooTotal }
        : { updated: wooUpdated, failed: wooFailed, failed_ids: wooFailedIds, has_more: wooHasMore, next_cursor: wooNextCursor, log_failed: wooLogFailed, log_failed_ids: wooLogFailedIds },
      mirakl: dryRun
        ? { would_update: spTotal }
        : { updated: spUpdated, failed: spFailed, failed_ids: spFailedIds, log_failed: spLogFailed, log_failed_ids: spLogFailedIds },
      linet: dryRun
        ? { would_update: linetTotal }
        : { updated: linetUpdated, failed: linetFailed, failed_ids: linetFailedIds, log_failed: linetLogFailed, log_failed_ids: linetLogFailedIds },
      summary,
    });
  } catch (e) {
    console.error('backfillOrderLocks error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});