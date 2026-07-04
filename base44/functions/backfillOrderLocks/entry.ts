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
    const wooCursor = body.woo_cursor || null;
    // SP cursor: pass sp_cursor from previous response to continue SP pagination
    const spCursor = body.sp_cursor || null;
    // Source flags — set to true to skip that source entirely
    const skipWoo = body.skip_woo === true;
    const skipSp = body.skip_sp === true;
    const skipLinet = body.skip_linet === true;
    const MAX_PER_CALL = 80; // per source per invocation (smaller = safer against timeout)
    const BATCH = 500;
    const MAX_PAGES = 50;
    const CHUNK_SIZE = 10; // concurrency per chunk

    // Unique run_id for rollback tracking — must be passed unchanged across all paginated calls
    const runId = body.run_id || new Date().toISOString();

    console.log(`🔒 backfillOrderLocks — dry_run=${dryRun}, skip_woo=${skipWoo}, skip_sp=${skipSp}, skip_linet=${skipLinet}, woo_cursor=${wooCursor}, sp_cursor=${spCursor}, run_id=${runId}`);

    // ─── WooCommerce ──────────────────────────────────────────────────
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

    while (!skipWoo) {
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
        const toProcess = batch.slice(0, MAX_PER_CALL - wooUpdated - wooFailed);
        if (toProcess.length === 0) {
          wooHasMore = true;
          wooNextCursor = cursorDate;
          break;
        }

        const chunks = chunk(toProcess, CHUNK_SIZE);
        for (const ch of chunks) {
          const results = await Promise.allSettled(
            ch.map(async (o) => {
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
              if (wooFailedIds.length < 20) wooFailedIds.push(ch[i].id);
              console.warn(`⚠️ Woo update failed ${ch[i].id}: ${results[i].reason?.message}`);
            }
          }
        }

        if (wooUpdated + wooFailed >= MAX_PER_CALL) {
          if (batch.length === BATCH) {
            wooHasMore = true;
            const lastProcessed = toProcess[toProcess.length - 1];
            wooNextCursor = lastProcessed?.order_date || null;
          }
          break;
        }
      }

      if (batch.length < BATCH) break;
      const last = batch[batch.length - 1];
      cursorDate = last.order_date || null;
      if (!cursorDate) break;

      pagesScanned++;
      if (pagesScanned >= MAX_PAGES) {
        if (!dryRun) { wooHasMore = true; wooNextCursor = cursorDate; }
        break;
      }
    }

    // ─── Mirakl / SuperPharmOrder (with cursor pagination) ──────────
    let spTotal = 0;
    let spUpdated = 0;
    let spFailed = 0;
    const spFailedIds = [];
    let spLogFailed = 0;
    const spLogFailedIds = [];
    let spHasMore = false;
    let spNextCursor = null;

    if (!skipSp) {
      // Fetch all eligible SP orders (SHIPPED/RECEIVED/CLOSED, not locked)
      const [spShipped, spReceived, spClosed] = await Promise.all([
        base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'SHIPPED', order_locked: { $ne: true } }, null, 500).catch(() => []),
        base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'RECEIVED', order_locked: { $ne: true } }, null, 500).catch(() => []),
        base44.asServiceRole.entities.SuperPharmOrder.filter({ order_state: 'CLOSED', order_locked: { $ne: true } }, null, 500).catch(() => []),
      ]);

      const spMap = new Map();
      for (const o of [...spShipped, ...spReceived, ...spClosed]) spMap.set(o.id, o);
      let spAll = Array.from(spMap.values());

      // Apply cursor: skip records up to and including the cursor id
      if (spCursor) {
        const idx = spAll.findIndex(o => o.id === spCursor);
        if (idx >= 0) spAll = spAll.slice(idx + 1);
      }

      spTotal = spAll.length;

      if (!dryRun) {
        const toProcess = spAll.slice(0, MAX_PER_CALL);
        const spChunks = chunk(toProcess, CHUNK_SIZE);

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

        if (spAll.length > MAX_PER_CALL) {
          spHasMore = true;
          spNextCursor = toProcess[toProcess.length - 1]?.id || null;
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

    if (!skipLinet) {
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
    }

    const totalLogFailed = wooLogFailed + spLogFailed + linetLogFailed;
    const summary = dryRun
      ? `[DRY RUN] would update ~${wooTotal} woo (this page), ${spTotal} mirakl remaining, ${linetTotal} linet`
      : `Updated: woo=${wooUpdated}/${wooUpdated+wooFailed}, sp=${spUpdated}/${spUpdated+spFailed}, linet=${linetUpdated}/${linetUpdated+linetFailed}`;
    console.log(`✅ ${summary}`);
    if (!dryRun && totalLogFailed > 0) {
      console.warn(`🚨 ROLLBACK COVERAGE GAP: ${totalLogFailed} orders locked WITHOUT a BackfillRunLog entry — woo:${wooLogFailed} sp:${spLogFailed} linet:${linetLogFailed}.`);
    }

    return Response.json({
      dry_run: dryRun,
      run_id: runId,
      woo: dryRun
        ? { would_update_this_page: wooTotal }
        : { updated: wooUpdated, failed: wooFailed, failed_ids: wooFailedIds, has_more: wooHasMore, next_cursor: wooNextCursor, log_failed: wooLogFailed, log_failed_ids: wooLogFailedIds },
      mirakl: dryRun
        ? { would_update_remaining: spTotal }
        : { updated: spUpdated, failed: spFailed, failed_ids: spFailedIds, has_more: spHasMore, next_cursor: spNextCursor, log_failed: spLogFailed, log_failed_ids: spLogFailedIds },
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