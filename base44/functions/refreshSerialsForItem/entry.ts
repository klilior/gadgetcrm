import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * refreshSerialsForItem — שליפה חיה מלינט לפריט אחד.
 *
 * למה סריקה מלאה: ה-API newsearch/inventory של לינט מתעלם מכל פרמטר סינון
 * (נבדק: item_id / sku / idcode / query / where → מוחזרות תמיד אותן שורות),
 * לכן הדרך היחידה לקבל מלאי חי היא דפדוף ולסנן בצד שלנו.
 *
 * הכתיבה מוגבלת לפריט המבוקש בלבד — אין סיכון להשבתת מלאי גלובלי.
 * קלט: { linet_item_id: number, exclude_line_id?: string }
 * פלט: { serials, count, scanned_rows, source: "linet_live" }
 */

async function getLinetCreds(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
  if (!login_id || !login_hash || !login_company) {
    const settingsList = await base44.asServiceRole.entities.Settings.list();
    const get = (n) => settingsList.find((s) => s.setting_name === n)?.setting_value;
    login_id = login_id || get("LINET_LOGIN_ID");
    login_hash = login_hash || get("LINET_LOGIN_HASH");
    login_company = login_company || get("LINET_LOGIN_COMPANY");
  }
  if (!login_id || !login_hash || !login_company) throw new Error("Missing Linet credentials");
  return { login_id: String(login_id), login_hash: String(login_hash), login_company: Number(login_company) };
}

const LIMIT = 500;
const MAX_PAGES = 40;
const BATCH = 4;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { linet_item_id, exclude_line_id } = await req.json();

    if (linet_item_id == null || Number.isNaN(Number(linet_item_id))) {
      return Response.json({ serials: [], count: 0, error: "חסר linet_item_id" }, { status: 400 });
    }
    const targetId = Number(linet_item_id);
    const creds = await getLinetCreds(base44);
    const now = new Date().toISOString();

    const fetchPage = async (offset) => {
      const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...creds, limit: LIMIT, offset }),
      });
      if (!res.ok) throw new Error(`Linet HTTP ${res.status}`);
      const parsed = await res.json();
      const rows = parsed?.data?.body ?? parsed?.body ?? null;
      return Array.isArray(rows) ? rows : [];
    };

    // סריקה חיה בקבוצות מקבילות עד שעמוד חוזר חלקי/ריק
    const liveRows = [];
    let scanned = 0;
    let done = false;
    for (let page = 0; page < MAX_PAGES && !done; page += BATCH) {
      const offsets = [];
      for (let i = 0; i < BATCH && page + i < MAX_PAGES; i++) offsets.push((page + i) * LIMIT);
      const results = await Promise.all(offsets.map(fetchPage));
      for (const rows of results) {
        scanned += rows.length;
        if (rows.length < LIMIT) done = true;
        for (const r of rows) if (Number(r.item_id) === targetId) liveRows.push(r);
      }
    }

    if (scanned === 0) {
      return Response.json({ serials: [], count: 0, error: "לינט לא החזיר מלאי — נסה שוב", source: "linet_live" });
    }

    // דה-דופליקציה של סריאלים שחוזרים בכמה עמודים
    const getQty = (r) => Number(r.ammount ?? r.amount ?? r.qty ?? 0);
    const liveMap = new Map();
    for (const r of liveRows) {
      const serial = r.idcode == null ? "" : String(r.idcode);
      if (!serial || getQty(r) <= 0) continue;
      if (!liveMap.has(serial)) liveMap.set(serial, { serial, qty: getQty(r), sku: r.item_sku != null ? String(r.item_sku) : undefined, item_name: r.item_name ?? undefined });
    }

    // upsert מקומי לפריט הזה בלבד
    const existing = await base44.asServiceRole.entities.SerialInventory.filter({ linet_item_id: targetId }).catch(() => []);
    const existingBySerial = new Map((existing || []).map((e) => [String(e.serial), e]));

    const toCreate = [], toUpdate = [];
    for (const [serial, row] of liveMap) {
      const rec = existingBySerial.get(serial);
      if (rec) toUpdate.push({ id: rec.id, qty: row.qty, active: true, last_synced: now });
      else toCreate.push({
        linet_item_id: targetId,
        sku: row.sku,
        item_name: row.item_name,
        serial,
        warehouse_id: 115,
        qty: row.qty,
        is_fictive: serial.includes("פקטיב") || serial.includes("פקיב"),
        active: true,
        last_synced: now,
      });
    }
    const toDeactivate = (existing || [])
      .filter((e) => e.active !== false && !liveMap.has(String(e.serial)))
      .map((e) => ({ id: e.id, active: false, last_synced: now }));

    if (toCreate.length) await base44.asServiceRole.entities.SerialInventory.bulkCreate(toCreate);
    if (toUpdate.length) await base44.asServiceRole.entities.SerialInventory.bulkUpdate(toUpdate);
    if (toDeactivate.length) await base44.asServiceRole.entities.SerialInventory.bulkUpdate(toDeactivate);

    // סינון סריאלים שכבר משויכים להזמנות פתוחות אחרות
    const taken = new Set<string>();
    const activeStatuses = ["selected", "verified", "invoiced"];
    const [osl, ois] = await Promise.all([
      base44.asServiceRole.entities.OrderSerialLine.filter({ serial_status: { $in: activeStatuses } }).catch(() => []),
      base44.asServiceRole.entities.OrderItemSerial.filter({ serial_status: { $in: activeStatuses } }).catch(() => []),
    ]);
    for (const l of [...osl, ...ois]) {
      if (exclude_line_id && l.id === exclude_line_id) continue;
      for (const s of (l.assigned_serials || [])) taken.add(String(s));
    }

    const serials = [...liveMap.values()]
      .filter((r) => !taken.has(r.serial))
      .map((r) => ({ serial: r.serial, is_fictive: r.serial.includes("פקטיב") || r.serial.includes("פקיב"), qty: r.qty }));

    return Response.json({
      serials,
      count: serials.length,
      scanned_rows: scanned,
      created: toCreate.length,
      deactivated: toDeactivate.length,
      synced_at: now,
      source: "linet_live",
    });
  } catch (err) {
    console.error("[refreshSerialsForItem]", err);
    return Response.json({ serials: [], count: 0, error: err.message, source: "linet_live" }, { status: 500 });
  }
});