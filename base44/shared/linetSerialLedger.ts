// linetSerialLedger — גישה ללינט + סריקת "אחזקות" סריאלים.
// newsearch/inventory מחזיר אחזקה של כל סריאל לפי חשבון: ספק = -1 (סיפק), מחסן (115, type 8) = +1 בזמן שהסריאל במלאי,
// לקוח (type 0) = +1 אחרי מכירה (ושורת המחסן נעלמת). לכן: סריאל במלאי ⇔ שורת +1 על חשבון מחסן.

export const LINET_BASE = "https://app.linet.org.il/api";
export const WAREHOUSE_ACCOUNT_ID = 115;
export const WAREHOUSE_ID = 115;
const LIMIT = 500;
const MAX_PAGES = 60;

export function linetCreds() {
  return {
    login_id: Deno.env.get("LINET_LOGIN_ID"),
    login_hash: Deno.env.get("LINET_LOGIN_HASH"),
    login_company: Number(Deno.env.get("LINET_LOGIN_COMPANY")),
  };
}

export async function linetPost(endpoint, body) {
  const res = await fetch(`${LINET_BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}

export function linetRows(r) {
  const b = r?.data?.body;
  return Array.isArray(b) ? b : [];
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

/** סריקה מלאה של אחזקות הסריאלים. wanted (אופציונלי) = Set של סריאלים לסינון. */
export async function scanSerialHoldings(c, wanted = null) {
  const bySerial = new Map();
  let scanned = 0;
  for (let page = 0; page < MAX_PAGES; page += 4) {
    const offsets = [];
    for (let i = 0; i < 4 && page + i < MAX_PAGES; i++) offsets.push((page + i) * LIMIT);
    const results = await Promise.all(offsets.map((offset) => linetPost("newsearch/inventory", { ...c, limit: LIMIT, offset })));
    let done = false;
    for (const r of results) {
      const rs = linetRows(r);
      scanned += rs.length;
      if (rs.length < LIMIT) done = true;
      for (const row of rs) {
        const serial = row.idcode == null ? "" : String(row.idcode);
        if (!serial || (wanted && !wanted.has(serial))) continue;
        if (!bySerial.has(serial)) bySerial.set(serial, []);
        bySerial.get(serial).push({
          item_id: Number(row.item_id),
          qty: Number(row.ammount ?? row.amount ?? row.qty ?? 0),
          item_name: row.item_name ?? "",
          item_sku: row.item_sku != null ? String(row.item_sku) : "",
          account_id: Number(row.account_id ?? 0),
          created: row.created ?? null,
        });
      }
    }
    if (done) break;
  }
  return { bySerial, scanned };
}

/**
 * מציאת חשבונית מס-קבלה (doctype 9) לפי refnum_ext. לינט לא מאפשר חיפוש לפי id/refnum — רק לפי טווח issue_date,
 * לכן מחפשים בחלון של ±daysAround ימים סביב מועד ההנפקה הידוע.
 */
export async function findLinetInvoiceByRef(c, refnumExt, aroundIso, daysAround = 3) {
  if (!aroundIso) return null;
  const center = new Date(aroundIso);
  if (Number.isNaN(center.getTime())) return null;
  const fmt = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const from = fmt(new Date(center.getTime() - daysAround * 86400000));
  const to = fmt(new Date(center.getTime() + daysAround * 86400000));
  const want = String(refnumExt);
  for (let offset = 0; offset < LIMIT * 10; offset += LIMIT) {
    const rs = linetRows(await linetPost("newsearch/docs", { ...c, limit: LIMIT, offset, query: { issue_date: `${from} to ${to}`, doctype: ["9"], refstatus: null } }));
    const hit = rs.find((d) => String(d.refnum_ext ?? "") === want && Number(d.doctype) === 9);
    if (hit) return hit;
    if (rs.length < LIMIT) break;
  }
  return null;
}

/** האם השורה מייצגת סריאל שנמצא פיזית במלאי המחסן */
export function isWarehouseHolding(row, itemId = null) {
  return row.qty > 0 && row.account_id === WAREHOUSE_ACCOUNT_ID && (itemId == null || row.item_id === Number(itemId));
}