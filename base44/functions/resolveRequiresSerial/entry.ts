import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * resolveRequiresSerial
 * קובע האם שורת הזמנה דורשת מספר סידורי לפי סדר עדיפויות:
 * 1. manual_override ב-LinetProductMap
 * 2. Linet stockType === 2
 * 3. קטגוריה חשודה (suspected_serial בלבד, לא חסימה)
 * 4. ברירת מחדל: false
 *
 * PURE READ-ONLY מ-Linet. כותב רק ל-OrderSerialLine ו-LinetProductMap.
 * כשל בקריאת Linet לא חוסם — ברירת מחדל false תמיד.
 */

// קטגוריות חשודות לסריאלי — זיהוי לפי שם מוצר בלבד (lowercase)
const SUSPECTED_SERIAL_KEYWORDS = [
  "iphone", "samsung galaxy", "pixel", "xiaomi", "oneplus", "huawei",
  "airpods", "galaxy buds", "beats studio", "beats fit",
  "apple watch", "galaxy watch", "samsung watch",
  "ipad", "galaxy tab", "surface pro",
];

function isSuspectedSerial(productName) {
  if (!productName) return false;
  const lower = productName.toLowerCase();
  return SUSPECTED_SERIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

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

async function fetchLinetItemBySku(creds, sku) {
  // newsearch/item מחזיר קטלוג רחב — מסננים בצד הקוד לפי sku מדויק
  const payload = {
    ...creds,
    limit: 200,
    offset: 0,
    query: JSON.stringify({ sku }),
  };
  const res = await fetch("https://app.linet.org.il/api/newsearch/item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Linet HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text);
  const body = Array.isArray(json?.data?.body) ? json.data.body :
               Array.isArray(json?.body) ? json.body : [];
  // סינון מדויק — sku חייב להתאים בדיוק
  return body.find((r) => String(r.sku ?? "").trim() === String(sku).trim()) ?? null;
}

async function resolveForItem({ base44, order_id, order_item_id, source, source_sku, source_product_name, quantity, dry_run }) {
  const log = { order_item_id, source_sku, source_product_name, quantity };
  let requires_serial = false;
  let serial_source = "default";
  let suspected_serial = false;
  let mapped_linet_item_id = null;
  let mapped_linet_sku = null;
  let mapped_linet_item_name = null;
  let linet_stock_type = null;

  // ── 1. manual_override ──────────────────────────────────────────────
  if (source_sku) {
    const maps = await base44.asServiceRole.entities.LinetProductMap.filter({ sku: source_sku }).catch(() => []);
    const existing = maps[0];
    if (existing?.manual_override === true) {
      requires_serial = existing.requires_serial;
      serial_source = "manual_override";
      mapped_linet_item_id = existing.linet_item_id ?? null;
      mapped_linet_sku = existing.linet_sku ?? null;
      mapped_linet_item_name = existing.linet_item_name ?? null;
      log.decision = requires_serial ? "requires_serial=true" : "requires_serial=false";
      log.rule = "1_manual_override";
      log.linet_stock_type = existing.linet_stock_type ?? null;
      return { requires_serial, serial_source, suspected_serial, mapped_linet_item_id, mapped_linet_sku, mapped_linet_item_name, linet_stock_type: existing.linet_stock_type ?? null, log };
    }
  }

  // ── 2. Linet stockType ──────────────────────────────────────────────
  if (source_sku) {
    try {
      const creds = await getLinetCreds(base44);
      const linetItem = await fetchLinetItemBySku(creds, source_sku);

      if (linetItem) {
        linet_stock_type = linetItem.stockType ?? linetItem.stock_type ?? null;
        mapped_linet_item_id = linetItem.id ?? linetItem.item_id ?? null;
        mapped_linet_sku = linetItem.sku ?? null;
        mapped_linet_item_name = linetItem.name ?? linetItem.item_name ?? null;

        log.linet_item_found = true;
        log.linet_stock_type = linet_stock_type;
        log.linet_item_id = mapped_linet_item_id;

        // שמור/עדכן LinetProductMap אם לא dry_run
        if (!dry_run) {
          const existing = (await base44.asServiceRole.entities.LinetProductMap.filter({ sku: source_sku }).catch(() => []))[0];
          const mapData = {
            sku: source_sku,
            linet_item_id: mapped_linet_item_id,
            linet_item_name: mapped_linet_item_name,
            linet_stock_type: linet_stock_type,
            requires_serial: linet_stock_type === 2,
            serial_source: "linet",
            last_checked: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (existing) {
            if (!existing.manual_override) {
              await base44.asServiceRole.entities.LinetProductMap.update(existing.id, mapData).catch(() => {});
            }
          } else {
            await base44.asServiceRole.entities.LinetProductMap.create(mapData).catch(() => {});
          }
        }

        if (linet_stock_type === 2) {
          requires_serial = true;
          serial_source = "linet";
          log.decision = "requires_serial=true";
          log.rule = "2_linet_stockType_2";
          return { requires_serial, serial_source, suspected_serial, mapped_linet_item_id, mapped_linet_sku, mapped_linet_item_name, linet_stock_type, log };
        }

        // נמצא ב-Linet אבל stockType לא 2 — לא סריאלי
        log.decision = "requires_serial=false";
        log.rule = "2_linet_stockType_not_2";
        return { requires_serial: false, serial_source: "linet", suspected_serial: false, mapped_linet_item_id, mapped_linet_sku, mapped_linet_item_name, linet_stock_type, log };
      } else {
        log.linet_item_found = false;
        log.linet_note = "לא נמצא ב-Linet לפי sku מדויק";
      }
    } catch (linetErr) {
      log.linet_error = linetErr.message;
      log.linet_note = "כשל בקריאת Linet — ברירת מחדל false, לא חוסם";
    }
  } else {
    log.linet_note = "אין source_sku — דילוג על בדיקת Linet";
  }

  // ── 3. קטגוריה חשודה ────────────────────────────────────────────────
  if (isSuspectedSerial(source_product_name)) {
    suspected_serial = true;
    serial_source = "category";
    log.decision = "requires_serial=false (suspected only, לא חוסם)";
    log.rule = "3_suspected_category";
    return { requires_serial: false, serial_source, suspected_serial, mapped_linet_item_id, mapped_linet_sku, mapped_linet_item_name, linet_stock_type, log };
  }

  // ── 4. ברירת מחדל ────────────────────────────────────────────────────
  log.decision = "requires_serial=false";
  log.rule = "4_default";
  return { requires_serial: false, serial_source: "default", suspected_serial: false, mapped_linet_item_id, mapped_linet_sku, mapped_linet_item_name, linet_stock_type, log };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const {
      order_id,
      order_item_id,
      source = "woo",
      source_sku,
      source_product_name,
      quantity = 1,
      dry_run = false,
    } = body;

    if (!order_item_id) {
      return Response.json({ error: "order_item_id נדרש" }, { status: 400 });
    }

    const result = await resolveForItem({
      base44, order_id, order_item_id, source, source_sku,
      source_product_name, quantity, dry_run,
    });

    // כתוב ל-OrderSerialLine (אם לא dry_run)
    if (!dry_run && order_id) {
      try {
        const serial_status = result.requires_serial ? "required_missing" : "not_required";
        const existing = (await base44.asServiceRole.entities.OrderSerialLine.filter({ order_item_id }).catch(() => []))[0];
        const lineData = {
          order_id,
          order_item_id,
          source,
          source_sku: source_sku ?? null,
          source_product_name: source_product_name ?? null,
          mapped_linet_item_id: result.mapped_linet_item_id,
          mapped_linet_sku: result.mapped_linet_sku,
          mapped_linet_item_name: result.mapped_linet_item_name,
          requires_serial: result.requires_serial,
          serials_required_count: result.requires_serial ? quantity : 0,
          serial_status,
          assigned_serials: [],
        };
        if (existing) {
          // לא דורסים שדות שכבר מולאו (assigned_serials, serial_verified_*)
          await base44.asServiceRole.entities.OrderSerialLine.update(existing.id, {
            ...lineData,
            assigned_serials: existing.assigned_serials?.length ? existing.assigned_serials : [],
            serial_verified_at: existing.serial_verified_at ?? null,
            serial_verified_by: existing.serial_verified_by ?? null,
          }).catch(() => {});
        } else {
          await base44.asServiceRole.entities.OrderSerialLine.create(lineData).catch(() => {});
        }
      } catch (writeErr) {
        result.log.write_error = writeErr.message;
      }
    }

    return Response.json({
      requires_serial: result.requires_serial,
      serial_source: result.serial_source,
      suspected_serial: result.suspected_serial,
      mapped_linet_item_id: result.mapped_linet_item_id,
      mapped_linet_item_name: result.mapped_linet_item_name,
      linet_stock_type: result.linet_stock_type,
      serial_status: result.requires_serial ? "required_missing" : "not_required",
      serials_required_count: result.requires_serial ? quantity : 0,
      dry_run,
      log: result.log,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});