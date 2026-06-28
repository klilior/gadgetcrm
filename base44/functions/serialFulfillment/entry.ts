import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const BASE_URL = "https://app.linet.org.il/api";
const SERIAL_STOCK_TYPE = "2";
const SUSPECT_SERIAL_CATEGORIES = [
  "טלפונים סלולרים", "טלפונים סלולריים", "שעונים חכמים", "טאבלטים", "AirPods",
];

// ---------- Linet helpers ----------
async function getCreds(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
  if (!login_id || !login_hash || !login_company) {
    const list = await base44.asServiceRole.entities.Settings.list();
    const g = (n) => list.find((s) => s.setting_name === n)?.setting_value;
    login_id = login_id || g("LINET_LOGIN_ID");
    login_hash = login_hash || g("LINET_LOGIN_HASH");
    login_company = login_company || g("LINET_LOGIN_COMPANY");
  }
  if (!login_id || !login_hash || !login_company) throw new Error("חסרות פרטי התחברות ללינט");
  return { login_id, login_hash, login_company: Number(login_company) };
}

async function linetSearch(creds, resource, query, limit = 100) {
  const res = await fetch(`${BASE_URL}/newsearch/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, limit, query }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  if (!res.ok) throw new Error(`Linet ${res.status} ${resource}: ${json?.error || text.slice(0, 300)}`);
  if (json?.error) throw new Error(`Linet error ${resource}: ${json.error}`);
  const body = json?.data?.body || json?.body || [];
  return Array.isArray(body) ? body : [];
}

// ---------- Core helpers ----------
function detectFromCategory(name) {
  return name ? SUSPECT_SERIAL_CATEGORIES.some((c) => name.includes(c)) : false;
}

async function fetchItemBySku(creds, sku) {
  let items = await linetSearch(creds, "item", { sku: String(sku) }, 1);
  if (!items?.length) {
    // fallback: order may store product_id as sku
    items = await linetSearch(creds, "item", { id: Number(sku) }, 1);
  }
  return items?.[0] || null;
}

async function resolveSerialRequirement(base44, creds, sku, userName) {
  const sr = base44.asServiceRole.entities;
  let map = (await sr.LinetProductMap.filter({ sku: String(sku) }).catch(() => []))?.[0] || null;
  let item = null;
  let isSerial = false, source = null, suspect = false;

  // 1. Manual override always wins
  if (map?.manual_override) {
    return { mapping: map, requires_serial: !!map.requires_serial, serial_source: map.serial_source };
  }

  // 2. Try fetching from Linet
  item = await fetchItemBySku(creds, sku);

  if (item) {
    if (String(item.stockType ?? "") === SERIAL_STOCK_TYPE) {
      isSerial = true; source = "linet";
    } else if (detectFromCategory(item.item_category) && map?.linet_item_id) {
      source = "category"; suspect = true;
    }
  }

  const nowIso = new Date().toISOString();
  const mapData = {
    sku: String(sku),
    linet_item_id: item ? String(item.id) : "",
    linet_sku: item?.sku || "",
    linet_item_name: item?.name || "",
    linet_category_name: item?.item_category || "",
    linet_inventory_type: item ? String(item.stockType ?? "") : "",
    requires_serial: isSerial, serial_source: source, manual_override: false,
    last_checked: nowIso, updated_by: userName, updated_at: nowIso,
  };
  map = map ? await sr.LinetProductMap.update(map.id, mapData) : await sr.LinetProductMap.create(mapData);
  return { mapping: map, requires_serial: isSerial, serial_source: source };
}

async function getAvailableSerials(creds, linetItemId, warehouseId = null) {
  const rows = await linetSearch(creds, "inventory", { item_id: Number(linetItemId) }, 500);
  const by = {};
  for (const r of rows) {
    if (!r.idcode) continue;
    if (warehouseId != null && String(r.account_id) !== String(warehouseId)) continue;
    if (!by[r.idcode]) by[r.idcode] = { idcode: r.idcode, net: 0, created: r.created, warehouse_id: r.account_id };
    by[r.idcode].net += parseFloat(r.ammount || "0");
  }
  const serials = Object.values(by).filter((s) => s.net > 0);
  return { serials };
}

async function audit(base44, d) {
  try { await base44.asServiceRole.entities.SerialAuditLog.create(d); } catch (_) {}
}

// ---------- Deno handler ----------
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const userName = user.employee_name || user.full_name || user.email || "unknown";
    const sr = base44.asServiceRole.entities;
    const creds = await getCreds(base44);
    const { action, params = {} } = await req.json();

    const allowed = { "resolveSerial": 1, "markSerial": 1, "unmarkSerial": 1, "searchLinetItems": 1, "getAvailableSerials": 1, "verifySerial": 1 };
    if (!allowed[action]) return Response.json({ error: `Unknown ${action}` }, { status: 400 });

    if (action === "resolveSerial") {
      const { sku } = params;
      if (!sku) return Response.json({ error: "Missing sku" });
      const r = await resolveSerialRequirement(base44, creds, sku, userName);
      return Response.json({ success: true, ...r });
    }

    if (action === "markSerial" || action === "unmarkSerial") {
      const wantSerial = action === "markSerial";
      const { sku, scope = "order", order_item_id } = params;
      if (scope === "always" && !sku) return Response.json({ error: "Missing sku" });
      if (scope === "always" && !wantSerial) {
        const item = await fetchItemBySku(creds, sku);
        if (item && String(item.stockType ?? "") === SERIAL_STOCK_TYPE) {
          if (user.role !== "admin" && user.app_role !== "מנהל")
            return Response.json({ success: false, blocked: true, error: "בלינט הפריט מוגדר כמלאי סידרתי. ביטול קבוע דורש אישור מנהל." });
        }
        if (user.role !== "admin" && user.app_role !== "מנהל")
          return Response.json({ success: false, blocked: true, error: "סימון קבוע דורש אישור מנהל." });
      }
      // Update permanent mapping
      if (scope === "always" && sku) {
        const nowIso = new Date().toISOString();
        let map = (await sr.LinetProductMap.filter({ sku: String(sku) }).catch(() => []))?.[0] || null;
        const md = { requires_serial: wantSerial, manual_override: true, serial_source: wantSerial ? "manual_serial" : "manual_not_serial", updated_by: userName, updated_at: nowIso };
        if (map) { map = await sr.LinetProductMap.update(map.id, { sku: String(sku), ...md, linet_item_id: map.linet_item_id }); }
        else { map = await sr.LinetProductMap.create({ sku: String(sku), ...md }); }
      }
      // Update order line
      if (order_item_id) {
        const lines = (await sr.OrderItemSerial.filter({ order_item_id: String(order_item_id) }).catch(() => []));
        const line = lines?.[0];
        if (line) await sr.OrderItemSerial.update(line.id, {
          requires_serial: wantSerial, serial_status: wantSerial ? "required_missing" : "not_required",
          serials_required_count: wantSerial ? (line.quantity || 1) : 0, assigned_serials: [],
        });
      }
      await audit(base44, { sku, order_item_id, action: wantSerial ? "mark_serial" : "unmark_serial", new_value: scope, user: userName, result: "success" });
      return Response.json({ success: true, scope });
    }

    if (action === "searchLinetItems") {
      const { term } = params;
      if (!term) return Response.json({ error: "Missing term" });
      const bySku = await linetSearch(creds, "item", { sku: String(term) }, 10);
      const byName = await linetSearch(creds, "item", { name: String(term) }, 10);
      const seen = new Set();
      const items = [...bySku, ...byName].filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true))).map((i) => ({
        id: i.id, sku: i.sku, name: i.name, stockType: String(i.stockType ?? ""), category: i.item_category || "", saleprice: i.saleprice,
      }));
      return Response.json({ success: true, items });
    }

    if (action === "getAvailableSerials") {
      const { linet_item_id } = params;
      if (!linet_item_id) return Response.json({ error: "Missing linet_item_id" });
      const { serials } = await getAvailableSerials(creds, linet_item_id);
      return Response.json({ success: true, serials });
    }

    if (action === "verifySerial") {
      const { linet_item_id, serial } = params;
      if (!linet_item_id || !serial) return Response.json({ error: "Missing params" });
      const { serials } = await getAvailableSerials(creds, linet_item_id);
      const match = serials.find((s) => String(s.idcode) === String(serial).trim());
      return Response.json({ success: true, valid: !!match, serial: match || null });
    }

    return Response.json({ error: "Unreachable" }, { status: 500 });
  } catch (error) {
    console.error("[serialFulfillment]", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});