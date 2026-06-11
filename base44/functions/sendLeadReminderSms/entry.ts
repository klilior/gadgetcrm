import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const toIsraelLocalString = (date = new Date()) => {
  const israel = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const y = israel.getFullYear();
  const m = String(israel.getMonth() + 1).padStart(2, '0');
  const d = String(israel.getDate()).padStart(2, '0');
  const h = String(israel.getHours()).padStart(2, '0');
  const min = String(israel.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
};

const isDue = (reminderAt, nowLocal) => {
  if (!reminderAt) return false;
  const raw = String(reminderAt).trim();
  if (!raw) return false;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw).getTime() <= Date.now();
  return raw.slice(0, 16) <= nowLocal;
};

const buildMessage = (lead, employee) => {
  const customer = lead.customer_name || 'לקוח ללא שם';
  const customerPhone = lead.phone || 'אין טלפון';
  const topic = lead.topic || lead.notes || 'פתק ללא תוכן';
  return `תזכורת פתק מהיר\nשלום ${employee.employee_name || lead.assigned_to_name || ''},\nלקוח: ${customer}\nטלפון: ${customerPhone}\nתוכן: ${topic}\nיש להיכנס לדשבורד ולטפל בפתק.`;
};

async function findEmployee(base44, lead) {
  if (lead.assigned_to) {
    try {
      const employee = await base44.asServiceRole.entities.Employee.get(lead.assigned_to);
      if (employee) return employee;
    } catch (_) {}
  }
  if (lead.assigned_to_name) {
    const matches = await base44.asServiceRole.entities.Employee.filter({ employee_name: lead.assigned_to_name }, '-updated_date', 1);
    if (matches?.[0]) return matches[0];
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let payload = {};
    try { payload = await req.json(); } catch (_) {}

    const dryRun = payload.dry_run === true;
    const nowLocal = toIsraelLocalString();
    const activeLeads = await base44.asServiceRole.entities.Lead.filter({ status: { $nin: ['Closed', 'Deleted'] } }, '-reminder_at', 500);
    const dueLeads = (activeLeads || []).filter(lead =>
      (lead.capture_type === 'Quick' || lead.quick_incomplete === true) &&
      lead.reminder_at &&
      !lead.reminder_done &&
      !lead.reminder_sms_sent_at &&
      isDue(lead.reminder_at, nowLocal)
    );

    let sent = 0;
    let failed = 0;
    const results = [];

    for (const lead of dueLeads) {
      const employee = await findEmployee(base44, lead);
      if (!employee?.phone) {
        failed++;
        results.push({ lead_id: lead.id, status: 'failed', reason: 'missing_employee_phone', assigned_to_name: lead.assigned_to_name || '' });
        if (!dryRun) {
          await base44.asServiceRole.entities.Lead.update(lead.id, {
            reminder_sms_status: 'failed',
            reminder_sms_error: 'לא נמצא מספר טלפון לנציג',
          });
        }
        continue;
      }

      const message = buildMessage(lead, employee);
      const fingerprint = `lead_reminder_sms|${lead.id}|${String(lead.reminder_at).slice(0, 16)}|${employee.phone}`;

      if (dryRun) {
        results.push({ lead_id: lead.id, employee: employee.employee_name, phone: employee.phone, status: 'dry_run' });
        continue;
      }

      const response = await base44.asServiceRole.functions.invoke('sendTextMeSMS', {
        action: 'send',
        to_phone: employee.phone,
        message,
        event_type: 'lead_reminder_sms',
        fingerprint,
      });
      const data = response?.data || response;

      if (data?.success) {
        sent++;
        await base44.asServiceRole.entities.Lead.update(lead.id, {
          reminder_done: true,
          reminder_sms_sent_at: new Date().toISOString(),
          reminder_sms_status: 'sent',
          reminder_sms_error: '',
        });
        results.push({ lead_id: lead.id, employee: employee.employee_name, phone: employee.phone, status: 'sent' });
      } else {
        failed++;
        await base44.asServiceRole.entities.Lead.update(lead.id, {
          reminder_sms_status: 'failed',
          reminder_sms_error: data?.error || 'שליחת SMS נכשלה',
        });
        results.push({ lead_id: lead.id, employee: employee.employee_name, phone: employee.phone, status: 'failed', error: data?.error || '' });
      }
    }

    return Response.json({ success: true, dry_run: dryRun, checked: activeLeads?.length || 0, due: dueLeads.length, sent, failed, now_local: nowLocal, results });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});