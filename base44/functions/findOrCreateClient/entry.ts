import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveOrCreateCustomer, PRODUCERS } from '../../shared/customerIdentity.ts';
import { resolveCorrelationId } from '../../shared/correlation.ts';

/**
 * Batch 1 of the producers migration — now goes through the central Creation Guard.
 * Ambiguous or invalid identities are never created and never silently matched to "the first" client.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}

    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });

    const { phone, full_name, email, city, full_address, preferred_channel, notes, woo_customer_id, linet_account_id } = body;
    if (!phone) return Response.json({ error: 'Phone number is required' }, { status: 400 });

    const correlation_id = resolveCorrelationId(req, body.correlation_id, 'find_or_create_client');

    const result = await resolveOrCreateCustomer(
      base44,
      {
        producer: PRODUCERS.FIND_OR_CREATE_CLIENT,
        phone,
        email,
        name: full_name,
        woo_customer_id: woo_customer_id ?? null,
        linet_account_id: linet_account_id ?? null,
        source_record_id: body.source_record_id || null,
        correlation_id,
      },
      {
        full_name: full_name || 'לקוח חדש',
        phone,
        email: email?.trim() || null,
        city: city?.trim() || null,
        full_address: full_address?.trim() || null,
        notes: notes?.trim() || null,
        preferred_channel: preferred_channel || 'whatsapp',
        source: body.source || 'Manual',
      },
    );

    if (result.status !== 'MATCHED') {
      return Response.json({
        success: false,
        status: result.status,
        blocked_reason: result.blocked_reason || result.status,
        candidates: result.candidates || [],
        evidence: result.evidence,
        message: result.status === 'AMBIGUOUS'
          ? 'נמצאו כמה לקוחות אפשריים לאותו טלפון — נדרשת בחירה ידנית'
          : 'לא ניתן לזהות לקוח מהנתונים שנשלחו',
        correlation_id,
      }, { status: 409 });
    }

    const client = await base44.asServiceRole.entities.Client.get(result.client_id);

    // Enrich empty fields only — never overwrite existing customer data.
    if (!result.created) {
      const updates: Record<string, any> = {};
      if (full_name && !client.full_name) updates.full_name = full_name;
      if (email && !client.email) updates.email = email;
      if (city && !client.city) updates.city = city;
      if (full_address && !client.full_address) updates.full_address = full_address;
      if (preferred_channel && !client.preferred_channel) updates.preferred_channel = preferred_channel;
      if (notes && client.notes !== notes) updates.notes = client.notes ? `${client.notes}\n${notes}` : notes;
      if (!client.normalized_phone && result.normalized_phone) {
        updates.normalized_phone = result.normalized_phone;
        updates.phone_validity = result.phone_validity;
      }
      if (Object.keys(updates).length > 0) {
        const updated = await base44.asServiceRole.entities.Client.update(client.id, updates);
        return Response.json({ client: updated, isNew: false, updated: true, match_method: result.match_method, message: 'לקוח קיים - עודכן עם מידע חדש' });
      }
      return Response.json({ client, isNew: false, updated: false, match_method: result.match_method, message: 'לקוח קיים נמצא במערכת' });
    }

    return Response.json({ client, isNew: true, updated: false, match_method: result.match_method, message: 'לקוח חדש נוצר בהצלחה' });
  } catch (error) {
    console.error('findOrCreateClient error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});