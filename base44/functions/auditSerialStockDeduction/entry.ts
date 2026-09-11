import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { linetCreds, linetPost, linetRows, mapLimit, scanSerialHoldings } from "../../shared/linetSerialLedger.ts";

/**
 * auditSerialStockDeduction — קריאה בלבד (לא יוצר/משנה כלום בלינט).
 * לכל שורה סריאלית שסומנה "הונפקה" בודק מול אחזקות הסריאל בלינט:
 *  - האם הסריאל עדיין מוחזק ע"י המחסן (= לא נגרע)
 *  - האם קיימת שורת מכירה ללקוח על הפריט הממופה (= נגרע כראוי)
 * התוצאה נשמרת ב-Settings("serial_stock_audit_latest") לשימוש deductUninvoicedSerials.
 */

async function accountTypes(c, ids) {
  const out = new Map();
  await mapLimit([...ids], 6, async (id) => {
    if (id === 0) { out.set(0, { type: 8, name: "ללא חשבון (מחסן)" }); return; }
    const a = linetRows(await linetPost("newsearch/accounts", { ...c, limit: 1, offset: 0, query: { id } }))[0];
    out.set(id, a ? { type: Number(a.type), name: a.name ?? "" } : { type: null, name: "" });
  });
  return out;
}

async function findInvoiceDoc(c, docId, ref) {
  if (docId && docId !== "pending") {
    const d = linetRows(await linetPost("newsearch/docs", { ...c, limit: 1, offset: 0, query: { id: Number(docId) } }))[0];
    if (d) return d;
  }
  if (!ref) return null;
  const stub = linetRows(await linetPost("newsearch/docs", { ...c, limit: 5, offset: 0, query: { refnum_ext: String(ref), doctype: ["9"] } }))[0];
  return stub ?? null;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const c = linetCreds();
    const sr = base44.asServiceRole.entities;

    const [osl, ois] = await Promise.all([
      sr.OrderSerialLine.filter({ requires_serial: true }, "created_date", 2000),
      sr.OrderItemSerial.filter({ requires_serial: true }, "created_date", 2000),
    ]);
    const lines = [
      ...osl.map((l) => ({ ...l, _entity: "OrderSerialLine" })),
      ...ois.map((l) => ({ ...l, _entity: "OrderItemSerial" })),
    ].filter((l) => (l.linet_invoice_id || l.serial_status === "invoiced") && Array.isArray(l.assigned_serials) && l.assigned_serials.length > 0);

    const { bySerial, scanned } = await scanSerialHoldings(c);
    if (scanned === 0) return Response.json({ error: "לינט לא החזיר מלאי — הבדיקה בוטלה" }, { status: 502 });

    const accIds = new Set();
    for (const l of lines) for (const s of l.assigned_serials) for (const m of (bySerial.get(String(s)) ?? [])) if (m.qty > 0) accIds.add(m.account_id);
    const accTypes = await accountTypes(c, accIds);
    const isWarehouse = (id) => id === 0 || accTypes.get(id)?.type === 8;
    const isCustomer = (id) => accTypes.get(id)?.type === 0;

    const results = await mapLimit(lines, 5, async (l) => {
      const isSP = l.source === "superpharm" || /^\d{9}-[A-Z]$/.test(String(l.order_id));
      let ref = null, customer = null, localDocId = null;
      if (isSP) {
        ref = l.order_id;
        const sp = (await sr.SuperPharmOrder.filter({ mirakl_order_id: l.order_id }).catch(() => []))[0];
        if (sp) {
          customer = { name: `${sp.customer_first_name ?? ""} ${sp.customer_last_name ?? ""}`.trim(), phone: sp.customer_phone ?? "" };
          localDocId = sp.linet_invoice_doc_id ?? null;
        }
      } else {
        const order = await sr.Order.get(String(l.order_id).replace(/^woo_/, "")).catch(() => null);
        if (order) {
          ref = order.external_order_number;
          let billing = {};
          try { billing = JSON.parse(order.raw_data_billing || "{}"); } catch (_) {}
          customer = { name: [billing.first_name, billing.last_name].filter(Boolean).join(" "), phone: billing.phone ?? "", client_id: order.client_id ?? null };
        }
      }

      const doc = await findInvoiceDoc(c, l.linet_invoice_id || localDocId, ref);

      const mappedId = Number(l.mapped_linet_item_id);
      const orderDate = l.created_date ? new Date(l.created_date).getTime() - 24 * 3600 * 1000 : 0;
      const serials = l.assigned_serials.map(String).map((s) => {
        const inv = bySerial.get(s) ?? [];
        const holders = inv.filter((x) => x.qty > 0).map((x) => ({ ...x, account_type: accTypes.get(x.account_id)?.type ?? null, account_name: accTypes.get(x.account_id)?.name ?? "" }));
        const warehouseRows = holders.filter((x) => isWarehouse(x.account_id));
        const saleRows = holders.filter((x) => isCustomer(x.account_id) && x.created && new Date(x.created).getTime() >= orderDate);
        const saleOnMapped = saleRows.find((x) => x.item_id === mappedId) ?? null;
        const saleOnOther = saleRows.find((x) => x.item_id !== mappedId) ?? null;
        return {
          serial: s,
          movements: inv,
          holders,
          warehouse_rows: warehouseRows,
          still_in_linet_stock: warehouseRows.length > 0,
          stock_item_matches_mapping: warehouseRows.some((x) => x.item_id === mappedId),
          sale_row_on_mapped_item: saleOnMapped,
          sale_row_on_other_item: saleOnOther,
          customer_account_id: (saleOnMapped ?? saleOnOther)?.account_id ?? null,
        };
      });

      return {
        line_id: l.id, entity: l._entity, source: l.source, order_id: l.order_id, order_ref: ref,
        product: l.source_product_name, source_sku: l.source_sku,
        mapped_linet_item_id: l.mapped_linet_item_id, mapped_linet_sku: l.mapped_linet_sku, mapped_linet_item_name: l.mapped_linet_item_name,
        customer,
        linet_doc: doc ? { id: doc.id, docnum: doc.docnum, doctype: doc.doctype, account_id: doc.account_id ?? null, company: doc.company ?? null, issue_date: doc.issue_date ?? null } : null,
        serials,
        needs_deduction: serials.some((s) => s.still_in_linet_stock),
      };
    });

    const needs = results.filter((r) => r.needs_deduction);
    const summary = {
      checked_lines: results.length,
      inventory_rows_scanned: scanned,
      needs_deduction_lines: needs.length,
      needs_deduction_serials: needs.reduce((n, r) => n + r.serials.filter((s) => s.still_in_linet_stock).length, 0),
      deducted_ok_lines: results.filter((r) => !r.needs_deduction && r.serials.every((s) => s.sale_row_on_mapped_item)).length,
      sold_on_other_item_serials: results.reduce((n, r) => n + r.serials.filter((s) => s.sale_row_on_other_item && !s.sale_row_on_mapped_item).length, 0),
      docs_not_found: results.filter((r) => !r.linet_doc).length,
    };

    const payload = { run_at: new Date().toISOString(), summary, needs_deduction: needs, all: results };
    const existing = await sr.Settings.filter({ setting_name: "serial_stock_audit_latest" }).catch(() => []);
    const val = JSON.stringify(payload);
    if (existing[0]) await sr.Settings.update(existing[0].id, { setting_value: val }); else await sr.Settings.create({ setting_name: "serial_stock_audit_latest", setting_value: val });

    return Response.json(payload);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}