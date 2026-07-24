import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeInvoiceNumber, dateOnly, numberValue } from '../../shared/linetInvoiceReconciliation.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const toDate = dateOnly(body.to_datetime || new Date().toISOString());
    const fromDate = dateOnly(body.from_datetime || new Date(Date.now() - 30 * 86400000).toISOString());
    const credentials = { login_id: Deno.env.get('LINET_LOGIN_ID'), login_hash: Deno.env.get('LINET_LOGIN_HASH'), login_company: Number(Deno.env.get('LINET_LOGIN_COMPANY')) };
    if (!credentials.login_id || !credentials.login_hash || !credentials.login_company) throw new Error('Missing Linet credentials');

    const documents = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const response = await fetch('https://app.linet.org.il/api/newsearch/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, limit: 100, offset, query: { issue_date: `${fromDate} to ${toDate}`, doctype: ['13'], refstatus: null } }) });
      if (!response.ok) throw new Error(`Linet API ${response.status}`);
      const payload = await response.json();
      if (payload.errorCode && payload.errorCode !== 0 && payload.errorCode !== 1000) throw new Error(payload.text || `Linet error ${payload.errorCode}`);
      const batch = payload.body || [];
      documents.push(...batch);
      if (batch.length < 100) break;
    }

    let created = 0;
    let updated = 0;
    const now = new Date().toISOString();
    for (let start = 0; start < documents.length; start += 100) {
      const batch = documents.slice(start, start + 100);
      const ids = batch.map((doc) => String(doc.id));
      const existing = await base44.asServiceRole.entities.LinetPurchaseDocument.filter({ linet_doc_id: { $in: ids } }, undefined, 100);
      const byId = new Map(existing.map((row) => [row.linet_doc_id, row]));
      const creates = [];
      const updates = [];
      for (const doc of batch) {
        const lines = Array.isArray(doc.docDetailes) ? doc.docDetailes : [];
        const record = {
          linet_doc_id: String(doc.id), linet_doc_number: String(doc.docnum || ''),
          supplier_invoice_number: String(doc.refnum_ext || doc.refnum || ''), normalized_invoice_number: normalizeInvoiceNumber(doc.refnum_ext || doc.refnum),
          doc_date: dateOnly(doc.ref_date) || dateOnly(doc.issue_date) || undefined, issue_date: dateOnly(doc.issue_date) || undefined,
          supplier_account_id: String(doc.account_id || ''), supplier_name: doc.company || doc.company_name || doc.account_name || '', supplier_vat_id: String(doc.vatnum || ''),
          subtotal_before_vat: numberValue(doc.sub_total), vat_amount: numberValue(doc.vat), total_with_vat: numberValue(doc.total),
          line_total_with_vat: numberValue(lines.reduce((sum, line) => sum + (numberValue(line.iTotalVat) || 0), 0)),
          lines_json: JSON.stringify(lines.map((line) => ({ sku: line.sku || '', name: line.name || '', quantity: numberValue(line.qty), total_before_vat: numberValue(line.iTotal), total_with_vat: numberValue(line.iTotalVat) }))),
          last_synced_at: now
        };
        const current = byId.get(record.linet_doc_id);
        if (current) updates.push({ id: current.id, ...record }); else creates.push(record);
      }
      if (creates.length) { await base44.asServiceRole.entities.LinetPurchaseDocument.bulkCreate(creates); created += creates.length; }
      if (updates.length) { await base44.asServiceRole.entities.LinetPurchaseDocument.bulkUpdate(updates); updated += updates.length; }
    }

    let reconciliation = null;
    if (body.skip_reconciliation !== true) {
      const result = await base44.asServiceRole.functions.invoke('reconcileLinetInvoices', { from_date: fromDate, to_date: toDate });
      reconciliation = result?.data || result;
    }
    return Response.json({ success: true, period: { from: fromDate, to: toDate }, fetched: documents.length, created, updated, reconciliation });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});