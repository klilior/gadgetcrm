export async function startMigrationRun(base44, input) {
  return await base44.asServiceRole.entities.MigrationRun.create({
    migration_type: input.migration_type,
    started_at: new Date().toISOString(),
    status: "RUNNING",
    executed_by_user_id: input.executed_by_user_id || null,
    dry_run: input.dry_run !== false,
    correlation_id: input.correlation_id,
    records_scanned: 0,
    records_changed: 0,
    records_skipped: 0,
    records_failed: 0,
    rollback_available: false,
    metadata: input.metadata || {},
  });
}

export async function finishMigrationRun(base44, runId, result) {
  return await base44.asServiceRole.entities.MigrationRun.update(runId, {
    completed_at: new Date().toISOString(),
    status: result.status || "COMPLETED",
    records_scanned: result.records_scanned || 0,
    records_changed: result.records_changed || 0,
    records_skipped: result.records_skipped || 0,
    records_failed: result.records_failed || 0,
    summary: result.summary || "",
    rollback_available: result.rollback_available === true,
    metadata: result.metadata || {},
  });
}