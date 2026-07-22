import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * updateOrderSerialLine
 * מעדכן assigned_serials ו-serial_status של OrderSerialLine מצד-השרת.
 * קלט: { line_id: string, assigned_serials: string[], serial_status: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { line_id, assigned_serials, serial_status } = body;

    if (!line_id) return Response.json({ error: "line_id נדרש" }, { status: 400 });

    // שליפת המצב הקודם כדי לדעת אילו סריאלים נוספו/הוסרו
    const prevLine = await base44.asServiceRole.entities.OrderSerialLine.get(line_id);
    const prevSerials = (prevLine?.assigned_serials ?? []).map(String);
    const nextSerials = (assigned_serials ?? []).map(String);

    await base44.asServiceRole.entities.OrderSerialLine.update(line_id, {
      assigned_serials: assigned_serials ?? [],
      serial_status: serial_status ?? "required_missing",
    });

    // עדכון מלאי: סריאל שנבחר → active=false (לא זמין); סריאל שבוטל → active=true (חוזר לזמינות)
    const added = nextSerials.filter((s) => !prevSerials.includes(s));
    const removed = prevSerials.filter((s) => !nextSerials.includes(s));
    const now = new Date().toISOString();
    try {
      if (added.length > 0) {
        await base44.asServiceRole.entities.SerialInventory.updateMany(
          { serial: { $in: added }, active: true },
          { $set: { active: false, last_synced: now } }
        );
      }
      if (removed.length > 0) {
        await base44.asServiceRole.entities.SerialInventory.updateMany(
          { serial: { $in: removed }, active: false },
          { $set: { active: true, last_synced: now } }
        );
      }
    } catch (invErr) {
      console.warn("[updateOrderSerialLine] inventory active-flag update failed (non-critical):", invErr.message);
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});