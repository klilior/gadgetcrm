import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * deductUninvoicedSerials — יישור מלאי לסריאלים שהונפקה עליהם חשבונית על מק"ט כללי ולא נגרעו מהמלאי בלינט.
 * לכל הזמנה כזו נוצרת תעודת משלוח (doctype 2) על שם הלקוח שעל החשבונית, עם הסריאלים על הפריט הנכון,
 * במחיר 0 (אין חיוב, אין חשבונית, אין שליחת מייל ללקוח).
 *
 * קלט: { apply?: boolean }  — ברירת מחדל dry-run (מציג מה ייווצר בלי ליצור).
 * מתבסס על תוצאת הבדיקה האחרונה (auditSerialStockDeduction) ומאמת מחדש מול המלאי החי בלינט לפני יצירה.
 */

import { linetCreds as creds, linetPost as linet, findLinetInvoiceByRef, scanSerialHoldings, isWarehouseHolding, WAREHOUSE_ACCOUNT_ID, WAREHOUSE_ID } from "../../shared/linetSerialLedger.ts";

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    let apply = false;
    try { const b = await req.json(); apply = !!b?.apply; } catch (_) {}

    const sr = base44.asServiceRole.entities;
    const c = creds();

    const auditRec = (await sr.Settings.filter({ setting_name: "serial_stock_audit_latest" }))[0];
    if (!auditRec) return Response.json({ error: "אין תוצאת בדיקה — יש להריץ קודם auditSerialStockDeduction" }, { status: 400 });
    const audit = JSON.parse(auditRec.setting_value);

    // ─── בחירת מועמדים: סריאל מוחזק ע"י המחסן (115) על הפריט הממופה, וללא שורת מכירה ללקוח ───
    const candidates = [];
    const manualReview = [];
    for (const line of audit.needs_deduction ?? []) {
      const stuck = line.serials.filter((s) => s.still_in_linet_stock);
      const clean = stuck.filter((s) =>
        !s.sale_row_on_mapped_item && !s.sale_row_on_other_item &&
        s.warehouse_rows.every((w) => w.account_id === WAREHOUSE_ACCOUNT_ID && w.item_id === Number(line.mapped_linet_item_id))
      );
      const dirty = stuck.filter((s) => !clean.includes(s));
      if (dirty.length > 0) manualReview.push({ order_ref: line.order_ref, source: line.source, customer: line.customer?.name, product: line.mapped_linet_item_name || line.product, serials: dirty.map((s) => ({ serial: s.serial, holders: s.holders })), reason: "הסריאל מוחזק בחשבון 0 (ללא מחסן) ו/או כבר מופיע אצל לקוח — דורש בדיקה ידנית" });
      if (clean.length > 0) candidates.push({ line, serials: clean.map((s) => s.serial) });
    }

    // ─── פתרון חשבון הלקוח לפי החשבונית שיצאה בלינט ───
    const byOrder = new Map();
    for (const cnd of candidates) {
      const l = cnd.line;
      const key = `${l.source}|${l.order_ref}`;
      if (!byOrder.has(key)) {
        // מועד הנפקת החשבונית — נדרש כי לינט מאפשר חיפוש מסמכים רק לפי טווח תאריכים
        let invoicedAt = null;
        if (l.source === "superpharm") {
          const sp = (await sr.SuperPharmOrder.filter({ mirakl_order_id: l.order_id }))[0];
          invoicedAt = sp?.linet_invoice_created_at ?? null;
        } else {
          const lineRec = await sr[l.entity]?.get(l.line_id).catch(() => null);
          invoicedAt = lineRec?.invoiced_at ?? lineRec?.serial_verified_at ?? null;
          if (!invoicedAt) {
            const ord = await sr.Order.get(l.order_id).catch(() => null);
            invoicedAt = ord?.invoice_issued_at ?? ord?.shipment_created_at ?? null;
          }
        }
        const doc = await findLinetInvoiceByRef(c, l.order_ref, invoicedAt);
        byOrder.set(key, { source: l.source, order_ref: l.order_ref, order_id: l.order_id, customer: l.customer, invoiced_at: invoicedAt, account_id: doc?.account_id ?? null, invoice_doc_id: doc?.id ?? null, invoice_doc_number: doc?.docnum ?? null, company: doc?.company ?? null, lines: [] });
      }
      byOrder.get(key).lines.push({ line_id: l.line_id, entity: l.entity, item_id: Number(l.mapped_linet_item_id), sku: l.mapped_linet_sku && !String(l.mapped_linet_sku).startsWith("sp_") ? l.mapped_linet_sku : "", name: l.mapped_linet_item_name || l.product || "", serials: cnd.serials });
    }

    const plans = [];
    for (const o of byOrder.values()) {
      if (!o.account_id) { manualReview.push({ order_ref: o.order_ref, source: o.source, customer: o.customer?.name, invoiced_at: o.invoiced_at, serials: o.lines.flatMap((x) => x.serials), reason: o.invoiced_at ? "לא נמצאה חשבונית מס-קבלה בלינט בחלון ±3 ימים סביב מועד ההנפקה" : "אין מועד הנפקה ידוע להזמנה — לא ניתן לחפש את החשבונית בלינט" }); continue; }
      const payload = {
        ...c,
        doctype: "2",
        status: 2,
        language: "he_il",
        account_id: String(o.account_id),
        company: o.company || o.customer?.name || "",
        currency_id: "ILS",
        currency_rate: "1.0000",
        refnum_ext: String(o.order_ref),
        description: `יישור מלאי סריאלי - הזמנה ${o.order_ref} - חשבונית ${o.invoice_doc_number ?? o.invoice_doc_id}`,
        comments: "תעודת משלוח ליישור מלאי בלבד. הסריאל נמכר בחשבונית שיצאה על מק\"ט כללי ולא נגרע מהמלאי. אין חיוב.",
        owner: 8669,
        docDet: o.lines.map((ln) => ({
          item_id: ln.item_id,
          sku: ln.sku,
          name: ln.name,
          qty: ln.serials.length,
          serial: ln.serials,
          iItem: 0,
          iItemWithVat: 1,
          currency_id: "ILS",
          vat_cat_id: 1,
          warehouse_id: WAREHOUSE_ID,
        })),
      };
      plans.push({ ...o, payload });
    }

    if (!apply) {
      return Response.json({
        dry_run: true,
        delivery_notes_to_create: plans.length,
        serials_to_deduct: plans.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.serials.length, 0), 0),
        plans: plans.map((p) => ({ order_ref: p.order_ref, source: p.source, customer: p.customer?.name, linet_account_id: p.account_id, invoice_doc_number: p.invoice_doc_number, lines: p.lines.map((l) => ({ item_id: l.item_id, name: l.name, serials: l.serials })) })),
        manual_review: manualReview,
      });
    }

    // ─── APPLY: אימות חי מול לינט לפני כל יצירה ───
    const wanted = new Set(plans.flatMap((p) => p.lines.flatMap((l) => l.serials)));
    const { bySerial: live, scanned } = await scanSerialHoldings(c, wanted);
    if (scanned === 0) return Response.json({ error: "לינט לא החזיר מלאי — לא נוצר דבר" }, { status: 502 });

    const created = [], skipped = [], failed = [];
    for (const p of plans) {
      const notInStock = p.lines.flatMap((l) => l.serials.filter((s) => !(live.get(s) ?? []).some((h) => isWarehouseHolding(h, l.item_id))));
      if (notInStock.length > 0) { skipped.push({ order_ref: p.order_ref, reason: "הסריאל כבר לא במלאי המחסן בבדיקה החיה", serials: notInStock }); continue; }

      const r = await linet("create/doc", p.payload);
      const body = r.data;
      const err = r.status !== 200 || body?.status === "error" || (body?.errorCode != null && body.errorCode !== 0);
      const docId = body?.body?.id ?? body?.id ?? null;
      if (err || !docId) { failed.push({ order_ref: p.order_ref, response: body }); break; }
      const docNum = body?.body?.docnum ?? body?.docnum ?? null;
      created.push({ order_ref: p.order_ref, customer: p.customer?.name, delivery_note_id: docId, delivery_note_number: docNum, serials: p.lines.flatMap((l) => l.serials) });

      for (const ln of p.lines) {
        for (const s of ln.serials) {
          await sr.SerialAuditLog.create({
            order_id: p.order_id, order_item_id: ln.line_id, linet_item_id: String(ln.item_id), serial: s,
            action: "stock_deduction_note", new_value: `תעודת משלוח ${docNum ?? docId}`, old_value: `חשבונית ${p.invoice_doc_number ?? p.invoice_doc_id}`,
            user: user.full_name || user.email, result: "success",
          }).catch(() => {});
        }
        await sr.SerialInventory.updateMany({ serial: { $in: ln.serials }, active: true }, { $set: { active: false, last_synced: new Date().toISOString() } }).catch(() => {});
      }
    }

    const log = { run_at: new Date().toISOString(), created, skipped, failed, manual_review: manualReview };
    const prev = (await sr.Settings.filter({ setting_name: "serial_stock_fix_log" }))[0];
    if (prev) await sr.Settings.update(prev.id, { setting_value: JSON.stringify(log) }); else await sr.Settings.create({ setting_name: "serial_stock_fix_log", setting_value: JSON.stringify(log) });

    return Response.json({ dry_run: false, ...log });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}