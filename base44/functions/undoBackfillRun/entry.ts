import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const { run_id, dry_run } = body;
    const dryRun = dry_run !== false; // default: dry run

    if (!run_id) {
      return Response.json({ error: 'run_id is required' }, { status: 400 });
    }

    console.log(`↩️ undoBackfillRun — run_id=${run_id}, dry_run=${dryRun}`);

    // Load all log entries for this run
    const logs = await base44.asServiceRole.entities.BackfillRunLog.filter(
      { run_id },
      null,
      5000
    ).catch(() => []);

    if (logs.length === 0) {
      return Response.json({ error: `No log entries found for run_id=${run_id}` }, { status: 404 });
    }

    if (dryRun) {
      const bySource = logs.reduce((acc, l) => {
        acc[l.source] = (acc[l.source] || 0) + 1;
        return acc;
      }, {});
      return Response.json({
        dry_run: true,
        run_id,
        total: logs.length,
        by_source: bySource,
        summary: `[DRY RUN] would undo ${logs.length} locks: ${JSON.stringify(bySource)}`,
      });
    }

    // Group by entity
    const byEntity = {};
    for (const log of logs) {
      if (!byEntity[log.entity_name]) byEntity[log.entity_name] = [];
      byEntity[log.entity_name].push(log);
    }

    const entityMap = {
      Order: 'Order',
      SuperPharmOrder: 'SuperPharmOrder',
      LinetOrderStatus: 'LinetOrderStatus',
    };

    let totalUndone = 0;
    let totalFailed = 0;
    const failedIds = [];

    for (const [entityName, entries] of Object.entries(byEntity)) {
      if (!entityMap[entityName]) continue;
      const chunks = chunk(entries, 100);
      for (const ch of chunks) {
        const results = await Promise.allSettled(
          ch.map(log =>
            base44.asServiceRole.entities[entityName].update(log.order_id, {
              order_locked: log.previous_order_locked || false,
              shipment_created_at: log.previous_shipment_created_at || null,
            })
          )
        );
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') {
            totalUndone++;
          } else {
            totalFailed++;
            if (failedIds.length < 20) failedIds.push(ch[i].order_id);
            console.warn(`⚠️ Undo failed ${ch[i].order_id}: ${results[i].reason?.message}`);
          }
        }
      }
    }

    const summary = `Undone: ${totalUndone}/${totalUndone + totalFailed}, failed: ${totalFailed}`;
    console.log(`✅ ${summary}`);

    return Response.json({
      dry_run: false,
      run_id,
      undone: totalUndone,
      failed: totalFailed,
      failed_ids: failedIds,
      summary,
    });
  } catch (e) {
    console.error('undoBackfillRun error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
});