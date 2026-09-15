import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveCustomerIdentity, resolveOrCreateCustomer, PRODUCERS } from '../../shared/customerIdentity.ts';
import { normalizeCustomerPhone, validateCustomerPhone, classifyCustomerEmail } from '../../shared/customerIdentityPolicy.ts';

/**
 * Safe POC — synthetic inputs only, dry_run by default. Creates no real customers.
 * Payload: { duplicate_phone?: string, linet_account_id?: number, woo_customer_id?: number }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const results: Record<string, any> = {};

    // 3 — phone format equivalence
    const formats = ['0541234567', '054-123-4567', '054 123 4567', '+972541234567', '972541234567', '00972541234567'];
    results.phone_formats = {
      inputs: formats,
      normalized: [...new Set(formats.map(normalizeCustomerPhone))],
      single_canonical: new Set(formats.map(normalizeCustomerPhone)).size === 1,
    };

    // 7 — invalid phone
    results.invalid_phone = {
      '123': validateCustomerPhone('123').validity,
      '0000': validateCustomerPhone('0000').validity,
      empty: validateCustomerPhone('').validity,
      resolution: (await resolveCustomerIdentity(base44, { producer: PRODUCERS.MANUAL_UI, phone: '123', name: 'בדיקה' })).status,
    };

    // 5 — Resend / placeholder email
    results.placeholder_email = {
      classification: classifyCustomerEmail('Zeno Rocha <zeno.rocha@resend.com>'),
      resolution: await resolveCustomerIdentity(base44, { producer: PRODUCERS.GMAIL_WEBHOOK, email: 'zeno.rocha@resend.com', name: 'Zeno Rocha' }),
    };

    // 6 — name only
    results.name_only = await resolveCustomerIdentity(base44, { producer: PRODUCERS.MANUAL_UI, name: 'לקוח לא קיים בדיקה' });

    // 1 — same Linet id twice
    if (body.linet_account_id) {
      const input = { producer: PRODUCERS.LINET_SYNC, linet_account_id: Number(body.linet_account_id), name: 'POC' };
      const a = await resolveCustomerIdentity(base44, input);
      const b = await resolveCustomerIdentity(base44, input);
      results.linet_twice = { first: a.status, second: b.status, same_client: a.client_id === b.client_id, client_id: a.client_id, method: a.match_method };
    }

    // 2 — same Woo id twice
    if (body.woo_customer_id) {
      const input = { producer: PRODUCERS.WOOCOMMERCE_WEBHOOK, woo_customer_id: Number(body.woo_customer_id), name: 'POC' };
      const a = await resolveCustomerIdentity(base44, input);
      const b = await resolveCustomerIdentity(base44, input);
      results.woo_twice = { first: a.status, second: b.status, same_client: a.client_id === b.client_id, client_id: a.client_id };
    }

    // 4 — known duplicate phone group → AMBIGUOUS
    if (body.duplicate_phone) {
      results.duplicate_group = await resolveCustomerIdentity(base44, { producer: PRODUCERS.MANUAL_UI, phone: body.duplicate_phone, name: 'POC לא תואם' });
    }

    // 8 — retry same request produces no duplicate create (dry run — no writes)
    const retryInput = { producer: PRODUCERS.FIND_OR_CREATE_CLIENT, phone: '0500000001', name: 'POC סינתטי', dry_run: true };
    const r1 = await resolveOrCreateCustomer(base44, retryInput);
    const r2 = await resolveOrCreateCustomer(base44, retryInput);
    results.retry_dry_run = { first: { status: r1.status, would_create: r1.would_create || false }, second: { status: r2.status, would_create: r2.would_create || false }, created_anything: Boolean(r1.created || r2.created) };

    return Response.json({ success: true, dry_run: true, results });
  } catch (error) {
    console.error('customerIdentityPoc error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});