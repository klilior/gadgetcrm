import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Determine which month to check: previous month relative to now
    const now = new Date();
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const checkMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const nextMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const monthNames = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
    const checkMonthLabel = `${monthNames[prevDate.getMonth()]} ${prevDate.getFullYear()}`;

    // Get all recurring suppliers
    const allSuppliers = await base44.asServiceRole.entities.Suppliers.filter({ is_recurring: true }, null, 200);
    if (allSuppliers.length === 0) {
      return Response.json({ message: "No recurring suppliers configured", month: checkMonth });
    }

    // Get all invoices that could match (this month and next for late arrivals)
    const allInvoices = await base44.asServiceRole.entities.Invoices.filter({}, null, 1000);
    const relevantInvoices = allInvoices.filter(inv => {
      if (!inv.doc_date) return false;
      const invMonth = inv.doc_date.slice(0, 7);
      return invMonth === checkMonth || invMonth === nextMonth;
    });

    // Get existing checks for this month
    const existingChecks = await base44.asServiceRole.entities.RecurringExpenseCheck.filter({ month: checkMonth }, null, 200);
    const checkMap = {};
    for (const c of existingChecks) checkMap[c.supplier_id] = c;

    const missing = [];
    
    for (const s of allSuppliers) {
      const existing = checkMap[s.id];
      
      // If already marked as received or manual - skip
      if (existing && existing.status !== "חסר") continue;

      // Try to match by supplier name or aliases
      const supplierNames = [s.name, ...(s.aliases || "").split(",").map(a => a.trim())].filter(Boolean);
      const matchedInv = relevantInvoices.find(inv =>
        supplierNames.some(name =>
          (inv.supplier || "").includes(name) || name.includes(inv.supplier || "")
        )
      );

      if (matchedInv) {
        // Auto-match
        if (existing) {
          await base44.asServiceRole.entities.RecurringExpenseCheck.update(existing.id, {
            status: "התקבל",
            matched_invoice_id: matchedInv.id,
            matched_invoice_number: matchedInv.doc_number || "",
          });
        } else {
          await base44.asServiceRole.entities.RecurringExpenseCheck.create({
            supplier_id: s.id,
            supplier_name: s.name,
            recurring_type: s.recurring_type || "",
            month: checkMonth,
            status: "התקבל",
            matched_invoice_id: matchedInv.id,
            matched_invoice_number: matchedInv.doc_number || "",
          });
        }
      } else {
        // Missing
        if (!existing) {
          await base44.asServiceRole.entities.RecurringExpenseCheck.create({
            supplier_id: s.id,
            supplier_name: s.name,
            recurring_type: s.recurring_type || "",
            month: checkMonth,
            status: "חסר",
          });
        }
        missing.push(`${s.name} (${s.recurring_type || "הוצאה קבועה"})`);
      }
    }

    // Send SMS alert if there are missing invoices
    if (missing.length > 0) {
      // Find manager user "ליאור"
      const users = await base44.asServiceRole.entities.User.filter({}, null, 100);
      const liorUser = users.find(u => 
        u.full_name?.includes("ליאור") && (u.role === "admin" || u.role === "מנהל")
      );
      
      // Also get phone from Employee entity
      const employees = await base44.asServiceRole.entities.Employee.filter({}, null, 100);
      const liorEmployee = employees.find(e => e.name?.includes("ליאור"));
      
      const phone = liorEmployee?.phone || liorUser?.phone;
      
      if (phone) {
        const missingList = missing.join("\n- ");
        const message = `⚠️ בקרת הוצאות קבועות - ${checkMonthLabel}\n\nחסרות ${missing.length} חשבוניות:\n- ${missingList}\n\nיש לבדוק בעמוד ניהול ספקים.`;

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: liorUser?.email || "",
          subject: `התראה: ${missing.length} חשבוניות הוצאה קבועה חסרות ל${checkMonthLabel}`,
          body: message,
        });

        // Send SMS via TextMe
        try {
          await base44.asServiceRole.functions.invoke("sendTextMeSMS", {
            action: "send",
            to_phone: phone,
            message,
            event_type: "recurring_expense_alert",
            fingerprint: `recurring|${checkMonth}|${Date.now()}`,
          });
        } catch (smsErr) {
          console.error("SMS send failed:", smsErr.message);
        }
      } else {
        console.warn("Could not find phone for ליאור");
      }
    }

    return Response.json({
      month: checkMonth,
      total_recurring: allSuppliers.length,
      missing_count: missing.length,
      missing_suppliers: missing,
      message: missing.length === 0 
        ? "כל החשבוניות התקבלו ✅" 
        : `${missing.length} חשבוניות חסרות`
    });
  } catch (error) {
    console.error("Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});