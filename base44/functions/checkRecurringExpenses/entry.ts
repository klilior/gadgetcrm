import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const dryRun = payload.dry_run === true;

    // Check previous month
    const now = new Date();
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const checkMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const nextMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthNames = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
    const checkMonthLabel = `${monthNames[prevDate.getMonth()]} ${prevDate.getFullYear()}`;

    const allSuppliers = await base44.asServiceRole.entities.Suppliers.filter({ is_recurring: true }, null, 200);
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

    for (const s of allSuppliers) {
      const existing = checkMap[s.id];
      if (existing && (existing.status === "התקבל" || existing.status === "אושר ידנית")) continue;

      const expected = s.expected_invoices_per_month || 1;
      const names = [s.name, ...(s.aliases || "").split(/[,|]/).map(a => a.trim())].filter(Boolean);

      // A fixed or mixed invoice satisfies a recurring expectation. A known goods-only invoice does not.
      const matched = relevant.filter(inv => {
        const supplierMatches = inv.supplier === s.id || names.some(n => (inv.supplier || "").includes(n) || n.includes(inv.supplier || ""));
        const hasRecurringContent = !inv.invoice_classification || inv.invoice_classification === 'fixed' || inv.invoice_classification === 'mixed';
        return supplierMatches && hasRecurringContent;
      });
      const receivedCount = matched.length;
      const status = receivedCount >= expected ? "התקבל" : receivedCount > 0 ? "חלקי" : "חסר";
      const matchedJson = JSON.stringify(matched.map(inv => ({ id: inv.id, doc_number: inv.doc_number || "", supplier: inv.supplier || "" })));

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

    // Send alerts only during a real scheduled run.
    if (missing.length > 0 && !dryRun) {
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
      message: missing.length === 0 ? "כל החשבוניות התקבלו ✅" : `${missing.length} הוצאות חסרות/חלקיות`,
    });
  } catch (error) {
    console.error("Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});