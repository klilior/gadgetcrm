import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    await base44.auth.isAuthenticated();

    const login_id = Deno.env.get("LINET_LOGIN_ID");
    const login_hash = Deno.env.get("LINET_LOGIN_HASH");
    const login_company = Number(Deno.env.get("LINET_LOGIN_COMPANY"));
    const creds = { login_id, login_hash, login_company };

    async function searchItem(queryObj, limit = 5) {
      const res = await fetch("https://app.linet.org.il/api/newsearch/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...creds, limit, offset: 0, query: queryObj }),
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { data = { _raw: text.slice(0, 300) }; }
      const rows = Array.isArray(data?.body) ? data.body : (Array.isArray(data) ? data : []);
      return {
        http_status: res.status,
        row_count: rows.length,
        rows: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, stockType: r.stockType })),
      };
    }

    // 1. חיפוש משלוח sku 19034 — שלוש וריאציות
    const shipping_str = await searchItem({ sku: "19034" });
    const shipping_key = await searchItem({ item_sku: "19034" });
    const shipping_num = await searchItem({ sku: 19034 });

    // 2. אימות AirPods (צפוי item_id=273)
    const airpods = await searchItem({ sku: "194252721247" });

    // 3. אימות מגן מסך (צפוי item_id=776)
    const screen_guard = await searchItem({ sku: "77998980" });

    return Response.json({
      shipping_sku_19034: {
        query_sku_string: shipping_str,
        query_item_sku_string: shipping_key,
        query_sku_number: shipping_num,
      },
      airpods_194252721247_expected_id_273: airpods,
      screen_guard_77998980_expected_id_776: screen_guard,
    });

  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack?.slice(0, 400) }, { status: 500 });
  }
});