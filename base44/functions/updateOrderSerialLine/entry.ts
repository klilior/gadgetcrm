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

    await base44.asServiceRole.entities.OrderSerialLine.update(line_id, {
      assigned_serials: assigned_serials ?? [],
      serial_status: serial_status ?? "required_missing",
    });

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});