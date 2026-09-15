/**
 * Controlled Super-Pharm customer migration.
 * Modes:
 *   classify — read-only classification of all orders without client_id
 *   poc      — small guarded run over a sampled mix
 *   batch    — controlled migration by category: A=matched, B=safe_new, C=ambiguous, D=unusable
 * Never merges clients, never rewrites the order's customer snapshot.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";
import { classifySpOrder, resolveSpOrderCustomer, spIdentityKey } from "../../shared/superpharmIdentity.ts";
import { createCorrelationId } from "../../shared/correlation.ts";

const CATEGORY_BY_BATCH: Record<string, string> = {
  A: "MATCHED_EXISTING",
  B: "SAFE_NEW_CUSTOMER",
  C: "AMBIGUOUS",
  D: "UNUSABLE",
};

async function loadUnlinkedOrders(sr: any) {
  const out: any[] = [];
  let skip = 0;
  while (true) {
    const page = await sr.SuperPharmOrder.filter({}, "-created_date", 200, skip);
    out.push(...page);
    if (page.length < 200 || out.length > 3000) break;
    skip += page.length;
  }
  return out.filter((o) => !o.client_id);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (user && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "classify";
    const dry_run = body.dry_run !== false;
    const correlation_id = body.correlation_id || createCorrelationId("superpharm_customer_migration");
    const sr = base44.asServiceRole.entities;

    const orders = await loadUnlinkedOrders(sr);

    // ── classify ─────────────────────────────────────────────────────────────
    const counts: Record<string, number> = {
      MATCHED_EXISTING: 0, SAFE_NEW_CUSTOMER: 0, AMBIGUOUS: 0, INVALID_IDENTITY: 0, NO_USABLE_IDENTITY: 0,
    };
    const byCategory: Record<string, any[]> = { MATCHED_EXISTING: [], SAFE_NEW_CUSTOMER: [], AMBIGUOUS: [], INVALID_IDENTITY: [], NO_USABLE_IDENTITY: [] };

    const scanLimit = mode === "classify" ? (body.limit || orders.length) : orders.length;
    for (const order of orders.slice(0, scanLimit)) {
      const c = await classifySpOrder(base44, order);
      counts[c.category] = (counts[c.category] || 0) + 1;
      byCategory[c.category].push({ order_id: order.mirakl_order_id, id: order.id, name: c.snapshot.name, phone: c.snapshot.phone, match_method: c.match_method, client_id: c.client_id, evidence: c.evidence });
    }

    if (mode === "classify") {
      return Response.json({
        success: true, mode, correlation_id, scanned: Math.min(scanLimit, orders.length),
        total_unlinked: orders.length, counts,
        samples: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, v.slice(0, 5)])),
        ambiguous: byCategory.AMBIGUOUS.slice(0, 20),
        unusable: [...byCategory.INVALID_IDENTITY, ...byCategory.NO_USABLE_IDENTITY].slice(0, 20),
      });
    }

    // ── poc / batch ──────────────────────────────────────────────────────────
    let targets: any[] = [];
    if (mode === "poc") {
      const pick = (cat: string, n: number) => byCategory[cat].slice(0, n).map((x) => orders.find((o) => o.id === x.id));
      targets = [
        ...pick("MATCHED_EXISTING", body.matched_count || 10),
        ...pick("SAFE_NEW_CUSTOMER", body.new_count || 10),
        ...pick("AMBIGUOUS", 2),
        ...pick("INVALID_IDENTITY", 1),
        ...pick("NO_USABLE_IDENTITY", 1),
      ].filter(Boolean);
    } else {
      const batch = String(body.batch || "").toUpperCase();
      const category = CATEGORY_BY_BATCH[batch];
      if (!category) return Response.json({ error: "batch must be A, B, C or D" }, { status: 400 });
      const source = category === "UNUSABLE"
        ? [...byCategory.INVALID_IDENTITY, ...byCategory.NO_USABLE_IDENTITY]
        : byCategory[category];
      targets = source.slice(0, body.limit || source.length).map((x) => orders.find((o) => o.id === x.id)).filter(Boolean);
    }

    const allowCreate = mode === "poc" ? true : String(body.batch || "").toUpperCase() === "B";
    const stats: Record<string, number> = {
      processed: 0, matched_existing: 0, clients_created: 0, ambiguous: 0, blocked: 0,
      invalid: 0, no_identity: 0, duplicate_creation_attempts_prevented: 0, orders_linked: 0, already_linked: 0,
    };
    const results: any[] = [];

    for (const order of targets) {
      const r = await resolveSpOrderCustomer(base44, order, { dry_run, allow_create: allowCreate, correlation_id });
      stats.processed++;
      if (r.category === "MATCHED_EXISTING") stats.matched_existing++;
      else if (r.category === "CLIENT_CREATED") stats.clients_created++;
      else if (r.category === "AMBIGUOUS") stats.ambiguous++;
      else if (r.category === "INVALID_IDENTITY") stats.invalid++;
      else if (r.category === "NO_USABLE_IDENTITY") stats.no_identity++;
      else if (r.category === "ALREADY_LINKED") stats.already_linked++;
      else stats.blocked++;
      if (r.idempotency_prevented) stats.duplicate_creation_attempts_prevented++;
      if (r.linked) stats.orders_linked++;
      results.push({ order_id: order.mirakl_order_id, category: r.category, client_id: r.client_id || null, match_method: r.match_method, created: Boolean(r.created), blocked_reason: r.blocked_reason || null, key: spIdentityKey(order) });
    }

    return Response.json({ success: true, mode, batch: body.batch || null, dry_run, correlation_id, allow_create: allowCreate, total_unlinked: orders.length, classification_counts: counts, stats, results });
  } catch (error) {
    console.error("[SP customer migration]", error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});