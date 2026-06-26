import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const BASE_URL = "https://app.linet.org.il/api";

// stockType value that means "serial inventory" in Linet (verified via debugLinetSerialItem)
const SERIAL_STOCK_TYPE = "2";

// Categories that are "suspected serial" even if Linet doesn't mark them — agent confirms.
const SUSPECT_SERIAL_CATEGORIES = [
  "טלפונים סלולרים",
  "טלפונים סלולריים",
  "שעונים חכמים",
  "טאבלטים",
  "AirPods",
];

// ---------- Linet credential + low-level call helpers ----------
async function getLinetCreds(base44) {
  let login_id = Deno.env.get("LINET_LOGIN_ID");
  let login_hash = Deno.env.get("LINET_LOGIN_HASH");
  let login_company = Deno.env.get("LINET_LOGIN_COMPANY");
  if (!login_id || !login_hash || !login_company) {
    const settingsList = await base44.asServiceRole.entities.Settings.list();
    const getSetting = (name) => settingsList.find((s) => s.setting_name === name)?.setting_value;
    login_id = login_id || getSetting("LINET_LOGIN_ID");
    login_hash = login_hash || getSetting("LINET_LOGIN_HASH");
    login_company = login_company || getSetting("LINET_LOGIN_COMPANY");
  }
  if (!login_id || !login_hash || !login_company) {
    throw new Error("Missing Linet credentials");
  }
  return { login_id, login_hash, login_company: Number(login_company) };
}

async function linetSearch(creds, resource, query, limit = 100, offset = 0) {
  const res = await fetch(`${BASE_URL}/newsearch/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, limit, offset, query }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  const body = json?.data?.body ?? json?.body ?? [];
  return Array.isArray(body) ? body : [];
}

// ---------- Serial detection ----------
function detectFromCategory(categoryName) {
  if (!categoryName) return false;
  return SUSPECT_SERIAL_CATEGORIES.some((c) => categoryName.includes(c));
}

async function resolveSerialRequirement(base44, creds, sku, userName) {
  const sr = base44.asServiceRole.entities;
  let mapping = (await sr.LinetProductMap.filter({ sku: String(sku) }))?.[0] || null;

  // 1. Manual override always wins
  if (mapping && mapping.manual_override === true) {
    return { mapping, requires_serial: !!mapping.requires_serial, serial_source: mapping.serial_source, suspected: false };
  }

  // 2. Check Linet item master
  const items = await linetSearch(creds, "item", { sku: String(sku) }, 1, 0);
  const item = items?.[0] || null;

  let requires_serial = false;
  let serial_source = null;
  let suspected = false;

  if (item) {
    const stockType = String(item.stockType ?? "");
    if (stockType === SERIAL_STOCK_TYPE) {
      requires_serial = true;
      serial_source = "linet";
    } else if (detectFromCategory(item.item_category || item.category_name)) {
      // 3. Suspected by category — don't force, let agent confirm
      requires_serial = false;
      serial_source = "category";
      suspected = true;
    }
  }

  const nowIso = new Date().toISOString();
  const mapData = {
    sku: String(sku),
    linet_item_id: item ? String(item.id) : (mapping?.linet_item_id || ""),
    linet_sku: item?.sku || mapping?.linet_sku || "",
    linet_item_name: item?.name || mapping?.linet_item_name || "",
    linet_category_name: item?.item_category || mapping?.linet_category_name || "",
    linet_inventory_type: item ? String(item.stockType ?? "") : (mapping?.linet_inventory_type || ""),
    requires_serial,
    serial_source: serial_source || mapping?.serial_source,
    manual_override: false,
    last_checked: nowIso,
    updated_by: userName,
    updated_at: nowIso,
  };

  if (mapping) {
    mapping = await sr.LinetProductMap.update(mapping.id, mapData);
  } else {
    mapping = await sr.LinetProductMap.create(mapData);
  }

  return { mapping, requires_serial, serial_source: serial_source, suspected };
}

// ---------- Available serials ----------
async function getAvailableSerials(creds, linetItemId, warehouseId = null) {
  const query = { item_id: Number(linetItemId) };
  const rows = await linetSearch(creds, "inventory", query, 500, 0);

  // Net availability per idcode: sum of ammount. >0 means currently in stock.
  const byCode = {};
  for (const r of rows) {
    const code = r.idcode;
    if (!code) continue;
    if (warehouseId !== null && warehouseId !== undefined && String(r.account_id) !== String(warehouseId)) continue;
    if (!byCode[code]) byCode[code] = { idcode: code, net: 0, created: r.created, warehouse_id: r.account_id, item_id: r.item_id, item_sku: r.item_sku };
    byCode[code].net += parseFloat(r.ammount || "0");
    if (r.created && r.created > byCode[code].created) byCode[code].created = r.created;
  }
  return Object.values(byCode).filter((c) => c.net > 0);
}

// ---------- Audit log ----------
async function audit(base44, data) {
  try {
    await base44.asServiceRole.entities.SerialAuditLog.create(data);
  } catch (e) {
    console.error("[serialFulfillment] audit failed:", e.message);
  }
}

function isAdmin(user) {
  return user.role === "admin" || user.app_role === "מנהל" || user?.data?.app_role === "מנהל";
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const userName = user.employee_name || user.full_name || user.email || "unknown";
    const sr = base44.asServiceRole.entities;

    const { action, params = {} } = await req.json();
    const creds = await getLinetCreds(base44);

    switch (action) {
      // Resolve requires_serial for a SKU (Step 3)
      case "resolveSerial": {
        const { sku } = params;
        if (!sku) return Response.json({ success: false, error: "Missing sku" });
        const r = await resolveSerialRequirement(base44, creds, sku, userName);
        return Response.json({ success: true, ...r });
      }

      // Manual mark/unmark a product as serial (Steps 4 & 5)
      case "markSerial":
      case "unmarkSerial": {
        const { sku, scope } = params; // scope: 'always' | 'order'
        // Permanent ('always') changes need a SKU to store on LinetProductMap.
        // Order-only changes update the OrderItemSerial line by order_item_id, so SKU is optional.
        if (!sku && scope === "always") return Response.json({ success: false, error: "Missing sku" });
        const wantSerial = action === "markSerial";

        let mapping = (await sr.LinetProductMap.filter({ sku: String(sku) }))?.[0] || null;

        // Guard: cannot permanently unmark a Linet serial item without admin (Step 5.4)
        if (!wantSerial && scope === "always") {
          const items = await linetSearch(creds, "item", { sku: String(sku) }, 1, 0);
          const isLinetSerial = items?.[0] && String(items[0].stockType ?? "") === SERIAL_STOCK_TYPE;
          if (isLinetSerial && !isAdmin(user)) {
            return Response.json({ success: false, blocked: true, error: "בלינט הפריט מוגדר כמלאי סידרתי. ביטול קבוע דורש אישור מנהל." });
          }
        }
        // Guard: permanent serial marking requires admin (Step 14)
        if (scope === "always" && !isAdmin(user)) {
          return Response.json({ success: false, blocked: true, error: "סימון קבוע של מוצר דורש אישור מנהל." });
        }

        if (scope === "always") {
          const nowIso = new Date().toISOString();
          const mapData = {
            sku: String(sku),
            requires_serial: wantSerial,
            manual_override: true,
            serial_source: wantSerial ? "manual_serial" : "manual_not_serial",
            updated_by: userName,
            updated_at: nowIso,
          };
          if (mapping) mapping = await sr.LinetProductMap.update(mapping.id, mapData);
          else mapping = await sr.LinetProductMap.create({ sku: String(sku), ...mapData });

          await audit(base44, { sku: String(sku), action: wantSerial ? "mark_serial" : "unmark_serial", new_value: "always", user: userName, result: "success" });
          return Response.json({ success: true, scope: "always", mapping });
        }

        // scope === 'order' -> only update the order item line
        const { order_item_id } = params;
        if (order_item_id) {
          const lines = await sr.OrderItemSerial.filter({ order_item_id: String(order_item_id) });
          const line = lines?.[0];
          if (line) {
            await sr.OrderItemSerial.update(line.id, {
              requires_serial: wantSerial,
              serials_required_count: wantSerial ? (line.quantity || 1) : 0,
              serial_status: wantSerial ? "required_missing" : "not_required",
            });
          }
        }
        await audit(base44, { sku: String(sku), order_item_id: params.order_item_id, action: wantSerial ? "mark_serial" : "unmark_serial", new_value: "order", user: userName, result: "success" });
        return Response.json({ success: true, scope: "order" });
      }

      // Search Linet items for mapping (Step 6)
      case "searchLinetItems": {
        const { term } = params;
        if (!term) return Response.json({ success: false, error: "Missing term" });
        const bySku = await linetSearch(creds, "item", { sku: String(term) }, 10, 0);
        const byName = await linetSearch(creds, "item", { name: String(term) }, 10, 0);
        const seen = new Set();
        const merged = [...bySku, ...byName].filter((i) => {
          if (seen.has(i.id)) return false;
          seen.add(i.id);
          return true;
        }).map((i) => ({
          id: i.id, sku: i.sku, name: i.name, stockType: String(i.stockType ?? ""),
          category: i.item_category || i.category_name || "", saleprice: i.saleprice,
        }));
        return Response.json({ success: true, items: merged });
      }

      // Get available serials for a mapped Linet item (Step 7)
      case "getAvailableSerials": {
        const { linet_item_id, warehouse_id } = params;
        if (!linet_item_id) return Response.json({ success: false, error: "Missing linet_item_id" });
        const serials = await getAvailableSerials(creds, linet_item_id, warehouse_id ?? null);
        return Response.json({ success: true, serials });
      }

      // Verify a typed/scanned serial belongs to the item & is available (Step 7/8)
      case "verifySerial": {
        const { linet_item_id, serial, warehouse_id } = params;
        if (!linet_item_id || !serial) return Response.json({ success: false, error: "Missing linet_item_id or serial" });
        const serials = await getAvailableSerials(creds, linet_item_id, warehouse_id ?? null);
        const match = serials.find((s) => String(s.idcode) === String(serial).trim());
        return Response.json({ success: true, valid: !!match, serial: match || null });
      }

      default:
        return Response.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error("[serialFulfillment] ERROR:", error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});