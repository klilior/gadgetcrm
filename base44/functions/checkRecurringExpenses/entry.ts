import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const dryRun = payload.dry_run === true;

    // Scheduled runs keep checking the previous month; the dashboard can request the current month explicitly.
    const now = new Date();
    const requestedMonth = /^\d{4}-\d{2}$/.test(payload.target_month || '') ? payload.target_month : null;
    const checkDate = requestedMonth ? new Date(`${requestedMonth}-01T12:00:00Z`) : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const checkMonth = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}`;
    const followingDate = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 1);
    const nextMonth = `${followingDate.getFullYear()}-${String(followingDate.getMonth() + 1).padStart(2, "0")}`;
    const monthNames = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
    const checkMonthLabel = `${monthNames[checkDate.getMonth()]} ${checkDate.getFullYear()}`;

    const allSuppliers = await base44.asServiceRole.entities.Suppliers.filter({ is_recurring: true }, 'id', 500);
    if (allSuppliers.length === 0) {
      return Response.json({ message: "No recurring suppliers configured", month: checkMonth });
    }

    // Get invoices from check month and next month (late arrivals)
    const allInvoices = await base44.asServiceRole.entities.Invoices.filter({}, null, 1000);
    const relevant = allInvoices.filter(inv => {
      if (!inv.doc_date) return false;
      const m = inv.doc_date.slice(0, 7);
      return m === checkMonth || m === nextMonth;
    });

    const existingChecks = await base44.asServiceRole.entities.RecurringExpenseCheck.filter({ month: checkMonth }, null, 200);
    const checkMap = {};
    for (const c of existingChecks) checkMap[c.supplier_id] = c;

    const missing = [];
    const results = [];

    for (const s of allSuppliers) {
      const existing = checkMap[s.id];
      if (existing?.status === "אושר ידנית") {
        results.push({ supplier: s, expected: existing.expected_count || 1, received: existing.received_count || 0, status: "התקבל", matched: [] });
        continue;
      }

      const expected = s.expected_invoices_per_month || 1;
      const names = [s.name, ...(s.aliases || "").split(/[,|]/).map(a => a.trim())].filter(Boolean);

      // A fixed or mixed invoice satisfies a recurring expectation. A known goods-only invoice does not.
      const matched = relevant.filter(inv => {
        const supplierMatches = inv.supplier === s.id || inv.detected_supplier_id === s.id || names.some(n => (inv.supplier_name || '').includes(n));
        const hasRecurringContent = !inv.invoice_classification || inv.invoice_classification === 'fixed' || inv.invoice_classification === 'mixed';
        return supplierMatches && hasRecurringContent;
      });
      const receivedCount = matched.length;
      const status = receivedCount >= expected ? "התקבל" : receivedCount > 0 ? "חלקי" : "חסר";
      const matchedJson = JSON.stringify(matched.map(inv => ({ id: inv.id, doc_number: inv.doc_number || "", supplier: inv.supplier || "" })));
      results.push({ supplier: s, expected, received: receivedCount, status, matched });

      if (!dryRun && existing) {
        await base44.asServiceRole.entities.RecurringExpenseCheck.update(existing.id, {
          received_count: receivedCount, status, matched_invoices_json: matchedJson, expected_count: expected,
        });
      } else if (!dryRun) {
        await base44.asServiceRole.entities.RecurringExpenseCheck.create({
          supplier_id: s.id, supplier_name: s.name, recurring_type: s.recurring_type || "",
          month: checkMonth, expected_count: expected, received_count: receivedCount,
          status, matched_invoices_json: matchedJson,
        });
      }

      if (status !== "התקבל") {
        missing.push(`${s.name} (${s.recurring_type || "הוצאה קבועה"}) - ${receivedCount}/${expected} חשבוניות`);
      }
    }

    // Keep the existing MissingInvoiceAlerts mechanism synchronized and idempotent per supplier/month.
    if (!dryRun) {
      const existingAlerts = await base44.asServiceRole.entities.MissingInvoiceAlerts.filter({ expected_period: checkMonth }, 'id', 500);
      const alertBySupplier = new Map(existingAlerts.map(alert => [alert.supplier_id, alert]));
      const alertUpdates = [];
      const alertCreates = [];
      for (const result of results) {
        const current = alertBySupplier.get(result.supplier.id);
        const isMissing = result.status !== "התקבל";
        const data = {
          supplier_id: result.supplier.id,
          expected_period: checkMonth,
          expected_date_range: `${checkMonth}-01`,
          status: isMissing ? "open" : "resolved",
          alert_type: "missing_invoice",
          alert_message: `${result.supplier.name}: התקבלו ${result.received} מתוך ${result.expected} חשבוניות צפויות`,
          resolved_by_invoice_id: isMissing ? "" : (result.matched[0]?.id || ""),
        };
        if (current) alertUpdates.push({ id: current.id, ...data });
        else if (isMissing) alertCreates.push({ ...data, created_at: now.toISOString() });
      }
      if (alertUpdates.length) await base44.asServiceRole.entities.MissingInvoiceAlerts.bulkUpdate(alertUpdates);
      if (alertCreates.length) await base44.asServiceRole.entities.MissingInvoiceAlerts.bulkCreate(alertCreates);
    }

    // Send alerts only during a real scheduled run, not dashboard refreshes.
    if (missing.length > 0 && !dryRun && payload.send_notifications !== false) {
      const users = await base44.asServiceRole.entities.User.filter({}, null, 100);
      const liorUser = users.find(u => u.full_name?.includes("ליאור") && (u.role === "admin" || u.role === "מנהל"));
      const employees = await base44.asServiceRole.entities.Employee.filter({}, null, 100);
      const liorEmployee = employees.find(e => e.name?.includes("ליאור"));
      const phone = liorEmployee?.phone || liorUser?.phone;

      if (phone) {
        const list = missing.join("\n- ");
        const message = `⚠️ בקרת הוצאות קבועות - ${checkMonthLabel}\n\nחסרות/חלקיות ${missing.length} הוצאות:\n- ${list}\n\nבדוק בעמוד ניהול ספקים.`;

        if (liorUser?.email) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: liorUser.email,
            subject: `התראה: ${missing.length} הוצאות קבועות חסרות ל${checkMonthLabel}`,
            body: message,
          });
        }

        try {
          await base44.asServiceRole.functions.invoke("sendTextMeSMS", {
            action: "send", to_phone: phone, message,
            event_type: "recurring_expense_alert",
            fingerprint: `recurring|${checkMonth}|${Date.now()}`,
          });
        } catch (smsErr) {
          console.error("SMS failed:", smsErr.message);
        }
      }
    }

    return Response.json({
      month: checkMonth, dry_run: dryRun, total_recurring: allSuppliers.length,
      missing_count: missing.length, missing_suppliers: missing,
      missing_details: results.filter(result => result.status !== "התקבל").map(result => ({ supplier_id: result.supplier.id, supplier_name: result.supplier.name, expected_count: result.expected, received_count: result.received, status: result.status })),
      message: missing.length === 0 ? "כל החשבוניות התקבלו" : `${missing.length} הוצאות חסרות/חלקיות`,
    });
  } catch (error) {
    console.error("Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});