import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * syncSerialInventory
 * סנכרון לילי של SerialInventory מ-Linet (newsearch/inventory).
 * מושך את כל המלאי הסריאלי, מסנן למחסן 115 + qty>0, ומבצע upsert.
 * סריאלים שקיימים ב-DB אך לא הגיעו הפעם → active=false (לא נמחקים).
 *
 * 🔴 הגנת ביטחון: אם Linet החזיר 0 שורות בסך הכל (תקלת API) — לא מסמנים כלום active=false.
 */

async function getLinetCreds(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
  if (!login_id || !login_hash || !login_company) {
    const settingsList = await base44.asServiceRole.entities.Settings.list();
    const getSetting = (name) => settingsList.find((s) => s.setting_name === name)?.setting_value;
    if (!login_id) login_id = getSetting("LINET_LOGIN_ID");
    if (!login_hash) login_hash = getSetting("LINET_LOGIN_HASH");
    if (!login_company) login_company = getSetting("LINET_LOGIN_COMPANY");
  }
  if (!login_id || !login_hash || !login_company) throw new Error("Missing Linet credentials");
  return { login_id: String(login_id), login_hash: String(login_hash), login_company: Number(login_company) };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date().toISOString();

    let dryRun = false;
    try { const b = await req.json(); dryRun = !!b?.dryRun; } catch { /* no body */ }

    const creds = await getLinetCreds(base44);

    // 1. משיכת כל המלאי הסריאלי מ-Linet עם דפדוף
    const LIMIT = 500;
    const MAX_PAGES = 60;
    let allRows = [];
    let pages_fetched = 0;

    for (let offset = 0; pages_fetched < MAX_PAGES; offset += LIMIT) {
      const res = await fetch("https://app.linet.org.il/api/newsearch/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...creds, limit: LIMIT, offset }),
      });

      if (!res.ok) {
        console.error(`[syncSerialInventory] Linet HTTP ${res.status} at offset ${offset} — aborting, no active=false marking`);
        return Response.json({ success: false, error: `Linet HTTP ${res.status}`, aborted: true });
      }

      const text = await res.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { 
        console.error("[syncSerialInventory] Invalid JSON from Linet — aborting");
        return Response.json({ success: false, error: "Invalid JSON from Linet", aborted: true });
      }

      const raw = parsed?.data?.body ?? parsed?.body ?? null;
      pages_fetched++;

      // guard: Linet מחזיר string כשאין עוד תוצאות
      if (!Array.isArray(raw) || raw.length === 0) break;

      allRows = allRows.concat(raw);
      if (raw.length < LIMIT) break;
    }

    // 3. סינון: qty>0 + סריאל (idcode) לא ריק.
    // המלאי כבר מגיע ממחסן 115 (אין שדה warehouse בתשובת Linet), warehouse_id נשמר קבוע בכתיבה.
    const getQty = (r) => Number(r.ammount ?? r.amount ?? r.qty ?? 0);
    const filtered = allRows.filter((r) => {
      const qty = getQty(r);
      const serial = r.idcode;
      return qty > 0 && serial != null && serial !== "";
    });

    // 🔴 הגנת ביטחון: 0 שורות מסוננות = תקלת API/פורמט. לא מסמנים active=false.
    if (allRows.length === 0 || filtered.length === 0) {
      console.error("[syncSerialInventory] ⚠️ 0 filtered rows from Linet — likely API/network/format failure. Aborting WITHOUT marking anything inactive.");
      return Response.json({
        success: false,
        aborted: true,
        error: "Linet returned 0 usable rows — aborted to protect inventory",
        fetched_from_linet: 0,
        total_linet_rows: allRows.length,
      });
    }

    // 4. מפת הסריאלים מ-Linet: מפתח linet_item_id + serial
    const keyOf = (itemId, serial) => `${Number(itemId)}::${String(serial)}`;
    const linetMap = new Map();
    for (const r of filtered) {
      const itemId = Number(r.item_id);
      const serial = String(r.idcode);
      linetMap.set(keyOf(itemId, serial), {
        linet_item_id: itemId,
        sku: r.item_sku != null ? String(r.item_sku) : undefined,
        item_name: r.item_name ?? undefined,
        serial,
        qty: getQty(r),
      });
    }

    // 5+6. טעינת כל ה-DB הקיים
    const existing = await base44.asServiceRole.entities.SerialInventory.list('-created_date', 20000);
    const existingByKey = new Map();
    for (const e of existing) {
      existingByKey.set(keyOf(e.linet_item_id, e.serial), e);
    }

    // חלוקה לפעולות: create / update / deactivate
    const toCreate = [];
    const toUpdate = [];
    for (const [k, row] of linetMap.entries()) {
      const existRec = existingByKey.get(k);
      const is_fictive = String(row.serial).includes("פקטיב") || String(row.serial).includes("פקיב");
      if (existRec) {
        toUpdate.push({ id: existRec.id, qty: row.qty, active: true, last_synced: now });
      } else {
        toCreate.push({
          linet_item_id: row.linet_item_id,
          sku: row.sku,
          item_name: row.item_name,
          serial: row.serial,
          warehouse_id: 115,
          qty: row.qty,
          is_fictive,
          active: true,
          last_synced: now,
        });
      }
    }

    const toDeactivate = existing
      .filter((e) => !linetMap.has(keyOf(e.linet_item_id, e.serial)) && e.active !== false)
      .map((e) => ({ id: e.id, active: false, last_synced: now }));

    // dryRun — לא כותב כלום, רק מדווח היקף
    if (dryRun) {
      return Response.json({
        success: true,
        dryRun: true,
        fetched_from_linet: filtered.length,
        total_linet_rows: allRows.length,
        pages_fetched,
        would_create: toCreate.length,
        would_update: toUpdate.length,
        would_deactivate: toDeactivate.length,
      });
    }

    // כתיבה ב-bulk (chunks של 500) — נמנע מ-rate limit של פעולות בודדות
    const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

    let created = 0, updated = 0, deactivated = 0;
    for (const c of chunk(toCreate, 500)) {
      await base44.asServiceRole.entities.SerialInventory.bulkCreate(c);
      created += c.length;
    }
    for (const c of chunk(toUpdate, 500)) {
      await base44.asServiceRole.entities.SerialInventory.bulkUpdate(c);
      updated += c.length;
    }
    for (const c of chunk(toDeactivate, 500)) {
      await base44.asServiceRole.entities.SerialInventory.bulkUpdate(c);
      deactivated += c.length;
    }

    const summary = {
      success: true,
      fetched_from_linet: filtered.length,
      total_linet_rows: allRows.length,
      pages_fetched,
      created,
      updated,
      deactivated,
    };
    console.log("[syncSerialInventory] summary:", JSON.stringify(summary));
    return Response.json(summary);

  } catch (err) {
    console.error("[syncSerialInventory] fatal:", err);
    return Response.json({ success: false, error: err.message });
  }
});