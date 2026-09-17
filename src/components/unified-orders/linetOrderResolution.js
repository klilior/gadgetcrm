import { base44 } from "@/api/base44Client";

// אמת אחת לטיפול בהזמנות ידניות מלינט:
// משימת "הזמנה שלא סופקה" בדשבורד וסטטוס ההזמנה במסך המרוכז מסונכרנים.

export async function fetchResolvedLinetDocNumbers() {
  const closed = await base44.entities.UndeliveredOrderTask
    .filter({ status: "Closed" }, '-closed_at', 500)
    .catch(() => []);
  return new Set(closed.map(t => String(t.source_doc_number || '')).filter(Boolean));
}

// כתיבת הסטטוס "טופל" לרשומת ההזמנה, כדי שכל צרכן אחר יראה את אותה אמת
export async function persistResolvedLinetStatus(docNumber, meta = {}) {
  const existing = await base44.entities.LinetOrderStatus
    .filter({ doc_number: String(docNumber) })
    .catch(() => []);
  if (existing.length > 0) {
    if (existing[0].status !== 'טופל') {
      await base44.entities.LinetOrderStatus.update(existing[0].id, { status: 'טופל' }).catch(() => {});
    }
    return;
  }
  await base44.entities.LinetOrderStatus.create({
    doc_number: String(docNumber),
    linet_doc_id: meta.linet_doc_id || '',
    status: 'טופל',
    customer_name: meta.customer_name || '',
    client_id: meta.client_id || ''
  }).catch(() => {});
}

// סגירת משימת הדשבורד כאשר ההזמנה סומנה כטופלה במסך המרוכז
export async function closeUndeliveredTaskForDoc(docNumber, userName) {
  if (!docNumber) return;
  const tasks = await base44.entities.UndeliveredOrderTask
    .filter({ source_doc_number: String(docNumber), status: "Open" })
    .catch(() => []);
  const now = new Date().toISOString();
  for (const task of tasks) {
    let log = [];
    try { log = JSON.parse(task.activity_log || '[]'); } catch (_) {}
    log.push({ action: 'סגירה: טופל במסך הזמנות מרוכזות', user: userName || '', timestamp: now });
    await base44.entities.UndeliveredOrderTask.update(task.id, {
      status: "Closed",
      closed_at: now,
      activity_log: JSON.stringify(log)
    }).catch(() => {});
  }
}