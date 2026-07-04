import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Sequential update with retry on rate-limit
async function updateWithRetry(entity, id, data, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await entity.update(id, data);
      return true;
    } catch (e) {
      if (e.message?.includes('Rate limit') && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const wooCursor = body.woo_cursor || null;
    const spCursor = body.sp_cursor || null;
    const skipWoo = body.skip_woo === true;
    const skipSp = body.skip_sp === true;
    const skipLinet = body.skip_linet === true;
    const MAX_PER_CALL = 50; // per source — sequential with retry, so manageable
    const BATCH = 500;
    const INTER_OP_DELAY = 80; // ms between each update call

    const runId = body.run_id || new Date().toISOString();
    console.log(`🔒 backfill — dry_run=${dryRun}, skip_woo=${skipWoo}, skip_sp=${skipSp}, skip_linet=${skipLinet}, run_id=${runId}`);

    // ─── Helper: process a list of records sequentially ─────────────
    async function processRecords(records, entityObj, source, entityName) {
      let updated = 0, failed = 0, logFailed = 0;
      const failedIds = [], logFailedIds = [];

      for (const o of records) {
        try {
          await updateWithRetry(entityObj, o.id, { order_locked: true, shipment_created_at: 'historical' });
          updated++;
          try {
            await base44.asServiceRole.entities.BackfillRunLog.create({
              run_id: runId, order_id: o.id, source, entity_name: entityName,
              previous_order_locked: o.order_locked || false,
              previous_shipment_created_at: o.shipment_created_at || null,
            });
          } catch (logErr) {
            logFailed++;
            if (logFailedIds.length < 10) logFailedIds.push(o.id);
          }
        } catch (e) {
          failed++;
          if (failedIds.length < 20) failedIds.push(o.id);
          console.warn(`⚠️ ${source} update failed ${o.id}: ${e.message}`);
        }
        if (INTER_OP_DELAY > 0) await new Promise(r => setTimeout(r, INTER_OP_DELAY));
      }
      return { updated, failed, failedIds, logFailed, logFailedIds };
    }

    // ─── WooCommerce ──────────────────────────────────────────────────
    let wooUpdated = 0, wooFailed = 0, wooLogFailed = 0;
    let wooFailedIds = [], wooLogFailedIds = [];
    let wooHasMore = false, wooNextCursor = null, wooTotal = 0;

    if (!skipWoo) {
      const filter = { status: 'completed', order_locked: { $ne: true } };
      if (wooCursor) filter['order_date'] = { $lt: wooCursor };
      const batch = await base44.asServiceRole.entities.Order.filter(filter, '-order_date', BATCH).catch(() => []);
      wooTotal = batch.length;

      if (!dryRun && batch.length > 0) {
        const toProcess = batch.slice(0, MAX_PER_CALL);
        const res = await processRecords(toProcess, base44.asServiceRole.entities.Order, 'woocommerce', 'Order');
        wooUpdated = res.updated; wooFailed = res.failed; wooFailedIds = res.failedIds;
        wooLogFailed = res.logFailed; wooLogFailedIds = res.logFailedIds;

        if (batch.length > MAX_PER_CALL || (wooFailed === 0 && batch.length === BATCH)) {
          wooHasMore = true;
          const lastProcessed = toProcess[toProcess.length - 1];
          wooNextCursor = lastProcessed?.order_date || null;
        } else if (wooFailed > 0) {
          // Some failed — cursor stays at same position so caller can retry
          wooHasMore = true;
          wooNextCursor = wooCursor;
        }
      }
    }

    // ─── Mirakl / SuperPharmOrder ──────────────────────────────────────
    let spUpdated = 0, spFailed = 0, spLogFailed = 0;
    let spFailedIds = [], spLogFailedIds = [];
    let spHasMore = false, spNextCursor = null, spTotal = 0;

    if (!skipSp) {
      const [spShipped, spReceived, spClosed] = await Promise.all([
        base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'SHIPPED', order_locked: { $ne: true } }, null, 500).catch(() => []),
        base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'RECEIVED', order_locked: { $ne: true } }, null, 500).catch(() => []),
        base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'CLOSED', order_locked: { $ne: true } }, null, 500).catch(() => []),
      ]);
      const spMap = new Map();
      for (const o of [...spShipped, ...spReceived, ...spClosed]) spMap.set(o.id, o);
      let spAll = Array.from(spMap.values());
      if (spCursor) {
        const idx = spAll.findIndex(o => o.id === spCursor);
        if (idx >= 0) spAll = spAll.slice(idx + 1);
      }
      spTotal = spAll.length;

      if (!dryRun && spAll.length > 0) {
        const toProcess = spAll.slice(0, MAX_PER_CALL);
        const res = await processRecords(toProcess, base44.asServiceRole.entities.SuperPharmOrder, 'mirakl', 'SuperPharmOrder');
        spUpdated = res.updated; spFailed = res.failed; spFailedIds = res.failedIds;
        spLogFailed = res.logFailed; spLogFailedIds = res.logFailedIds;

        if (spAll.length > MAX_PER_CALL) {
          spHasMore = true;
          spNextCursor = toProcess[toProcess.length - 1]?.id || null;
        } else if (spFailed > 0) {
          spHasMore = true;
          spNextCursor = spCursor;
        }
      }
    }

    // ─── Linet ────────────────────────────────────────────────────────
    let linetUpdated = 0, linetFailed = 0, linetLogFailed = 0;
    let linetFailedIds = [], linetLogFailedIds = [];
    let linetTotal = 0;

    if (!skipLinet) {
      const linetDone = await base44.asServiceRole.entities.LinetOrderStatus.filter(
        { status: 'טופל', order_locked: { $ne: true } }, null, 500
      ).catch(() => []);
      linetTotal = linetDone.length;

      if (!dryRun && linetDone.length > 0) {
        const res = await processRecords(linetDone, base44.asServiceRole.entities.LinetOrderStatus, 'linet', 'LinetOrderStatus');
        linetUpdated = res.updated; linetFailed = res.failed; linetFailedIds = res.failedIds;
        linetLogFailed = res.logFailed; linetLogFailedIds = res.logFailedIds;
      }
    }

    const summary = dryRun
      ? `[DRY RUN] would update ~${wooTotal} woo, ${spTotal} mirakl, ${linetTotal} linet`
      : `Updated: woo=${wooUpdated}/${wooUpdated+wooFailed}, sp=${spUpdated}/${spUpdated+spFailed}, linet=${linetUpdated}/${linetUpdated+linetFailed}`;
    console.log(`✅ ${summary}`);

    return Response.json({
      dry_run: dryRun, run_id: runId,
      woo: dryRun ? { would_update: wooTotal }
        : { updated: wooUpdated, failed: wooFailed, failed_ids: wooFailedIds, has_more: wooHasMore, next_cursor: wooNextCursor, log_failed: wooLogFailed, log_failed_ids: wooLogFailedIds },
      mirakl: dryRun ? { would_update_remaining: spTotal }
        : { updated: spUpdated, failed: spFailed, failed_ids: spFailedIds, has_more: spHasMore, next_cursor: spNextCursor, log_failed: spLogFailed, log_failed_ids: spLogFailedIds },
      linet: dryRun ? { would_update: linetTotal }
        : { updated: linetUpdated, failed: linetFailed, failed_ids: linetFailedIds, log_failed: linetLogFailed, log_failed_ids: linetLogFailedIds },
      summary,
    });
  } catch (e) {
    console.error('backfill error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});