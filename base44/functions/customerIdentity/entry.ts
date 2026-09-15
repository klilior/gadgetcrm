import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveCustomerIdentity, resolveOrCreateCustomer, PRODUCERS } from '../../shared/customerIdentity.ts';
import { resolveCorrelationId } from '../../shared/correlation.ts';
import { logAudit } from '../../shared/audit.ts';

/**
 * The only entry point the UI may use to resolve or create a customer.
 * actions: "resolve" (read-only) | "resolve_or_create" (guarded creation)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const correlation_id = resolveCorrelationId(req, body.correlation_id, 'customer_identity');
    const action = body.action || 'resolve';

    const input = {
      producer: PRODUCERS.MANUAL_UI,
      phone: body.phone,
      email: body.email,
      name: body.full_name || body.name,
      linet_account_id: body.linet_account_id ?? null,
      woo_customer_id: body.woo_customer_id ?? null,
      source_record_id: body.source_record_id || null,
      correlation_id,
      dry_run: Boolean(body.dry_run),
    };

    if (action === 'resolve') {
      const resolution = await resolveCustomerIdentity(base44, input);
      return Response.json({ success: true, ...resolution, correlation_id });
    }

    if (action !== 'resolve_or_create') {
      return Response.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const resolution = await resolveCustomerIdentity(base44, input);

    // A manual creation attempt on an existing phone returns a warning + candidates — never auto-merge.
    if (!body.confirm_create && (resolution.status === 'MATCHED' || resolution.status === 'AMBIGUOUS')) {
      return Response.json({
        success: true,
        ...resolution,
        created: false,
        warning: resolution.status === 'MATCHED' ? 'CANDIDATE_MATCH_FOUND' : 'AMBIGUOUS_CANDIDATES',
        correlation_id,
      });
    }

    // Manual override (create anyway) — admins only, always audited.
    if (body.confirm_create && resolution.status !== 'NO_MATCH') {
      if (user.role !== 'admin') {
        return Response.json({ error: 'Manual override requires admin', ...resolution }, { status: 403 });
      }
      await logAudit(base44, {
        actor_user_id: user.id,
        entity_type: 'Client',
        entity_id: resolution.client_id || 'unresolved',
        action: 'CUSTOMER_MANUAL_OVERRIDE',
        source: 'USER',
        correlation_id,
        after_data: { resolution_status: resolution.status, match_method: resolution.match_method },
      }).catch(() => null);
    }

    const result = await resolveOrCreateCustomer(base44, input, {
      full_name: body.full_name,
      phone: body.phone || null,
      email: body.email || null,
      city: body.city || null,
      full_address: body.full_address || null,
      notes: body.notes || null,
      preferred_channel: body.preferred_channel || null,
      source: body.source || 'Manual',
    });

    const client = result.client_id ? await base44.asServiceRole.entities.Client.get(result.client_id).catch(() => null) : null;
    return Response.json({ success: true, ...result, client });
  } catch (error) {
    console.error('customerIdentity error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});