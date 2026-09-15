import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { normalizeCustomerPhone, validateCustomerPhone, classifyCustomerEmail } from '../../shared/customerIdentityPolicy.ts';

/** Read-only Data Quality metrics for customer identity. No writes. */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const sr = base44.asServiceRole.entities;
    const clients: any[] = [];
    let skip = 0;
    while (true) {
      const batch = await sr.Client.list('-created_date', 500, skip);
      clients.push(...batch);
      if (batch.length < 500) break;
      skip += batch.length;
      if (skip > 30000) break;
    }

    const now = Date.now();
    const windows = { '24h': 1, '7d': 7, '30d': 30 };
    const active = clients.filter((c) => !c.excluded_from_identity_matching && c.customer_quality_status !== 'TEST_DATA');

    const phoneGroups = new Map<string, any[]>();
    for (const c of active) {
      const { normalized_phone, validity } = validateCustomerPhone(c.normalized_phone || c.phone);
      if (validity === 'VALID_MOBILE' || validity === 'VALID_LANDLINE') {
        phoneGroups.set(normalized_phone, [...(phoneGroups.get(normalized_phone) || []), c]);
      }
    }
    const dupPhones = new Set([...phoneGroups.entries()].filter(([, v]) => v.length > 1).map(([k]) => k));

    const countExternalDupes = (field: string) => {
      const m = new Map<string, number>();
      active.forEach((c) => { const v = c[field]; if (v) m.set(String(v), (m.get(String(v)) || 0) + 1); });
      return [...m.values()].filter((n) => n > 1).length;
    };

    const new_clients: Record<string, number> = {};
    const new_duplicate_phones: Record<string, number> = {};
    for (const [label, days] of Object.entries(windows)) {
      const inWindow = clients.filter((c) => now - new Date(c.created_date).getTime() < days * 86400000);
      new_clients[label] = inWindow.length;
      new_duplicate_phones[label] = inWindow.filter((c) => dupPhones.has(normalizeCustomerPhone(c.normalized_phone || c.phone))).length;
    }

    const audits = await sr.AuditLog.filter({ entity_type: 'Client' }, '-created_date', 2000).catch(() => []);
    const auditCount = (action: string, days: number) =>
      audits.filter((a: any) => a.action === action && now - new Date(a.created_date).getTime() < days * 86400000).length;

    // Per-producer identity metrics (LINET_SYNC / WOOCOMMERCE_WEBHOOK / ...)
    const producerActions = ['CUSTOMER_RESOLUTION_MATCH', 'CUSTOMER_CREATION', 'CUSTOMER_RESOLUTION_AMBIGUOUS', 'CUSTOMER_CREATION_BLOCKED', 'CUSTOMER_EXTERNAL_ID_CONFLICT', 'CUSTOMER_EXTERNAL_ID_LINKED'];
    const producerMetrics: Record<string, Record<string, number>> = {};
    audits
      .filter((a: any) => producerActions.includes(a.action) && now - new Date(a.created_date).getTime() < 30 * 86400000)
      .forEach((a: any) => {
        const key = a.integration || 'UNKNOWN';
        const m = producerMetrics[key] || (producerMetrics[key] = { processed: 0, matched: 0, created: 0, ambiguous: 0, blocked: 0, external_id_conflicts: 0, external_ids_linked: 0 });
        m.processed++;
        if (a.action === 'CUSTOMER_RESOLUTION_MATCH') m.matched++;
        if (a.action === 'CUSTOMER_CREATION') m.created++;
        if (a.action === 'CUSTOMER_RESOLUTION_AMBIGUOUS') m.ambiguous++;
        if (a.action === 'CUSTOMER_CREATION_BLOCKED') m.blocked++;
        if (a.action === 'CUSTOMER_EXTERNAL_ID_CONFLICT') m.external_id_conflicts++;
        if (a.action === 'CUSTOMER_EXTERNAL_ID_LINKED') m.external_ids_linked++;
      });

    // New duplicate external IDs created inside a window
    const dupExternalValues = (field: string) => {
      const m = new Map<string, number>();
      active.forEach((c) => { const v = c[field]; if (v) m.set(String(v), (m.get(String(v)) || 0) + 1); });
      return new Set([...m.entries()].filter(([, n]) => n > 1).map(([k]) => k));
    };
    const dupLinet = dupExternalValues('linet_account_id');
    const dupWoo = dupExternalValues('woo_customer_id');
    const newDupExternal = (set: Set<string>, field: string) => {
      const res: Record<string, number> = {};
      for (const [label, days] of Object.entries({ '24h': 1, '7d': 7 })) {
        res[label] = clients.filter((c) => c[field] && set.has(String(c[field])) && now - new Date(c.created_date).getTime() < days * 86400000).length;
      }
      return res;
    };

    const producers: Record<string, number> = {};
    clients.filter((c) => now - new Date(c.created_date).getTime() < 30 * 86400000)
      .forEach((c) => { const k = c.created_by_producer || c.source || 'UNKNOWN'; producers[k] = (producers[k] || 0) + 1; });

    return Response.json({
      success: true,
      generated_at: new Date().toISOString(),
      total_clients: clients.length,
      new_clients,
      new_duplicate_normalized_phones: new_duplicate_phones,
      duplicate_external_ids: { linet: countExternalDupes('linet_account_id'), woo: countExternalDupes('woo_customer_id') },
      ambiguous_resolutions: { '24h': auditCount('CUSTOMER_AMBIGUOUS', 1), '7d': auditCount('CUSTOMER_AMBIGUOUS', 7), '30d': auditCount('CUSTOMER_AMBIGUOUS', 30) },
      blocked_creations: { '24h': auditCount('CUSTOMER_CREATION_BLOCKED', 1), '7d': auditCount('CUSTOMER_CREATION_BLOCKED', 7), '30d': auditCount('CUSTOMER_CREATION_BLOCKED', 30) },
      external_id_conflicts: { '30d': auditCount('CUSTOMER_EXTERNAL_ID_CONFLICT', 30) },
      manual_overrides: { '30d': auditCount('CUSTOMER_MANUAL_OVERRIDE', 30) },
      invalid_phone_identities: active.filter((c) => validateCustomerPhone(c.normalized_phone || c.phone).validity === 'INVALID').length,
      empty_phone_identities: active.filter((c) => validateCustomerPhone(c.normalized_phone || c.phone).validity === 'EMPTY').length,
      non_identity_emails: clients.filter((c) => c.email && !classifyCustomerEmail(c.email).usable_for_identity).length,
      excluded_identities: clients.filter((c) => c.excluded_from_identity_matching).length,
      quality_status_breakdown: clients.reduce((acc: Record<string, number>, c) => {
        const k = c.customer_quality_status || 'ACTIVE';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      duplicate_phone_groups: dupPhones.size,
      producer_identity_metrics_30d: producerMetrics,
      new_duplicate_linet_ids: newDupExternal(dupLinet, 'linet_account_id'),
      new_duplicate_woo_ids: newDupExternal(dupWoo, 'woo_customer_id'),
      producer_distribution_30d: producers,
    });
  } catch (error) {
    console.error('customerDataQualityMetrics error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});