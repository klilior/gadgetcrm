import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Serial-aware invoice issuing + blocking gates (Steps 8, 9, 10).
 *
 * PILOT SAFETY: dry_run defaults to TRUE. When dry_run=true NO real Linet invoice
 * is created — the function only validates, runs all gates, and reports what WOULD happen.
 * Real issuing requires an explicit dry_run:false from the caller (to be enabled after acceptance tests).
 */

async function audit(base44, data) {
  try { await base44.asServiceRole.entities.SerialAuditLog.create(data); }
  catch (e) { console.error("[serialInvoice] audit failed:", e.message); }
}

// Gate 1: can we invoice? (Step 9.1)
async function checkInvoiceBlock(sr, orderId) {
  const lines = await sr.OrderItemSerial.filter({ order_id: String(orderId) }).catch(() => []);
  const serialLines = lines.filter((l) => l.requires_serial);
  const reasons = [];

  for (const line of serialLines) {
    const name = line.mapped_linet_item_name || line.source_product_name || line.source_sku || "מוצר";
    if (!line.mapped_linet_item_id) reasons.push(`חסר מיפוי Linet עבור ${name}`);
    const need = line.serials_required_count || line.quantity || 1;
    const have = (line.assigned_serials || []).length;
    if (have < need) reasons.push(`חסר מספר סידורי מאומת עבור ${name} (${have}/${need})`);
    if (line.serial_status !== "verified" && line.serial_status !== "invoiced") reasons.push(`הסריאלי לא אומת מול Linet עבור ${name}`);
  }
  return { blocked: reasons.length > 0, reasons, serialLines, allLines: lines };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const userName = user.employee_name || user.full_name || user.email || "unknown";
    const sr = base44.asServiceRole.entities;

    const { action, params = {} } = await req.json();

    switch (action) {
      // Reserve serials for an order line (Step 8 lock)
      case "reserveSerials": {
        const { order_item_id, serials } = params;
        if (!order_item_id || !Array.isArray(serials)) return Response.json({ success: false, error: "Missing order_item_id or serials" });

        // Ensure no serial is reserved/assigned on another active line
        for (const s of serials) {
          // Filter by serial status to avoid loading all records
          const othersVerified = await sr.OrderItemSerial.filter({ serial_status: "verified" }).catch(() => []);
          const othersSelected = await sr.OrderItemSerial.filter({ serial_status: "selected" }).catch(() => []);
          const others = [...othersVerified, ...othersSelected];
          const conflict = others.find((l) =>
            l.order_item_id !== String(order_item_id) &&
            (l.assigned_serials || []).includes(String(s))
          );
          if (conflict) {
            await audit(base44, { order_item_id, serial: String(s), action: "select_serial", result: "blocked", error_message: "serial already used in another order", user: userName });
            return Response.json({ success: false, blocked: true, error: `הסריאלי ${s} כבר משויך להזמנה אחרת.` });
          }
        }

        const lines = await sr.OrderItemSerial.filter({ order_item_id: String(order_item_id) }).catch(() => []);
        const line = lines?.[0];
        if (!line) return Response.json({ success: false, error: "שורת מוצר לא נמצאה" });

        const need = line.serials_required_count || line.quantity || 1;
        const uniqueSerials = [...new Set(serials.map((s) => String(s).trim()))];
        if (uniqueSerials.length !== serials.length) return Response.json({ success: false, error: "לא ניתן לבחור אותו סריאלי פעמיים" });

        const status = uniqueSerials.length >= need ? "verified" : "selected";
        const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const updatePayload = {
          assigned_serials: uniqueSerials,
          serial_status: status,
          serial_verified_at: status === "verified" ? new Date().toISOString() : null,
          serial_verified_by: status === "verified" ? userName : null,
          reserved: true,
          reserved_by: userName,
          reserved_at: new Date().toISOString(),
          reservation_expires_at: expires,
        };

        try {
          await sr.OrderItemSerial.update(line.id, updatePayload);
        } catch (updateErr) {
          // Record may have been replaced (stale id) — re-fetch and retry once
          const fresh = await sr.OrderItemSerial.filter({ order_id: String(line.order_id), order_item_id: String(order_item_id) }).catch(() => []);
          const freshLine = fresh?.[0];
          if (!freshLine) return Response.json({ success: false, error: "שורת מוצר לא נמצאה אחרי ניסיון חוזר" });
          await sr.OrderItemSerial.update(freshLine.id, updatePayload);
        }

        await audit(base44, { order_id: line.order_id, order_item_id, sku: line.source_sku, linet_item_id: line.mapped_linet_item_id, serial: uniqueSerials.join(","), action: "select_serial", new_value: status, user: userName, result: "success" });
        return Response.json({ success: true, status, assigned_serials: uniqueSerials });
      }

      // Gate checks only (no issuing) - used by UI to enable/disable buttons (Step 9)
      case "checkGates": {
        const { order_id } = params;
        if (!order_id) return Response.json({ success: false, error: "Missing order_id" });
        const invoiceCheck = await checkInvoiceBlock(sr, order_id);
        const hasSerialLine = invoiceCheck.serialLines.length > 0;
        const hasInvoicedSerial = invoiceCheck.serialLines.every((l) => l.serial_status === "invoiced" && l.linet_invoice_id);
        return Response.json({
          success: true,
          has_serial_line: hasSerialLine,
          invoice_blocked: invoiceCheck.blocked,
          invoice_block_reasons: invoiceCheck.reasons,
          shipment_blocked: hasSerialLine && !hasInvoicedSerial,
          complete_blocked: hasSerialLine && !hasInvoicedSerial,
        });
      }

      // Issue serial invoice (Step 10) - DRY RUN by default
      case "issueInvoice": {
        const { order_id, dry_run = true } = params;
        if (!order_id) return Response.json({ success: false, error: "Missing order_id" });

        const check = await checkInvoiceBlock(sr, order_id);
        if (check.blocked) {
          await audit(base44, { order_id, action: "issue_invoice_failed", result: "blocked", error_message: check.reasons.join("; "), user: userName });
          return Response.json({ success: false, blocked: true, error: `לא ניתן להנפיק חשבונית: ${check.reasons.join("; ")}` });
        }

        // Idempotency (Step 10.1)
        const alreadyInvoiced = check.serialLines.filter((l) => l.linet_invoice_id);
        if (alreadyInvoiced.length === check.serialLines.length && check.serialLines.length > 0) {
          return Response.json({ success: true, already_invoiced: true, message: "חשבונית כבר הופקה להזמנה זו" });
        }

        const invoiceLines = check.serialLines.map((l) => ({
          linet_item_id: l.mapped_linet_item_id,
          linet_sku: l.mapped_linet_sku,
          name: l.mapped_linet_item_name,
          quantity: l.quantity || 1,
          serials: l.assigned_serials || [],
        }));

        if (dry_run) {
          await audit(base44, { order_id, action: "issue_invoice", new_value: "dry_run", result: "success", user: userName });
          return Response.json({
            success: true,
            dry_run: true,
            message: "מצב בדיקה (dry-run): לא הופקה חשבונית אמיתית. כך תיראה החשבונית:",
            would_issue: invoiceLines,
          });
        }

        // REAL ISSUING IS INTENTIONALLY NOT WIRED YET (pilot safety).
        return Response.json({ success: false, error: "הפקת חשבונית אמיתית עדיין לא מופעלת. נדרש אישור והשלמת בדיקות הקבלה." });
      }

      default:
        return Response.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error("[serialInvoice] ERROR:", error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});