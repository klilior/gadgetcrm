import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  // Parse body safely - automations may send empty body
  let body = {};
  try { body = await req.json(); } catch (_) {}

  try {
    console.log('[scheduledPriceCheck] Starting automated price check...');

    // Get all active products using service role
    const products = await base44.asServiceRole.entities.ProductsMonitor.filter({ is_active: true });
    
    if (!products || products.length === 0) {
      console.log('[scheduledPriceCheck] No active products');
      return Response.json({ success: true, message: 'אין מוצרים פעילים', checked: 0 });
    }

    console.log(`[scheduledPriceCheck] Found ${products.length} active products`);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const today = () => new Date().toISOString().slice(0, 10);
    const cleanPrice = (txt) => {
      if (!txt) return null;
      let cleaned = String(txt).replace(/&#8362;/g, '').replace(/&[a-z]+;/gi, '').replace(/₪/g, '').replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
      const n = Math.round(parseFloat(cleaned));
      return (n >= 100 && n <= 100000) ? n : null;
    };
    const safeDelta = (a, b) => (a != null && b != null) ? a - b : null;

    // ─── Scrape WooCommerce ───
    async function scrapeWoo(url, zapMyPrice) {
      if (!url) return { ok: false, error: 'אין קישור WC' };
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'he-IL,he;q=0.9',
            'Accept': 'text/html',
            'Cache-Control': 'no-cache',
          },
          redirect: 'follow',
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const html = await res.text();
        const candidates = [];

        // Strategies
        const jsonLdBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
        for (const block of jsonLdBlocks) {
          try {
            const data = JSON.parse(block[1]);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              const price = item?.offers?.price || item?.offers?.[0]?.price || item?.price;
              if (price) { const p = cleanPrice(price); if (p) candidates.push({ value: p, strategy: 'S1' }); }
            }
          } catch (_) {}
        }

        const metaMatches = [...html.matchAll(/itemprop=["']price["']\s+content=["']([^"']+)["']/gi)];
        for (const mm of metaMatches) { const p = cleanPrice(mm[1]); if (p) candidates.push({ value: p, strategy: 'S2' }); }

        const srAllMatches = [...html.matchAll(/המחיר הנוכחי הוא:\s*₪?([\d,.]+)/gi)];
        for (const sr of srAllMatches) { const p = cleanPrice(sr[1]); if (p) candidates.push({ value: p, strategy: 'S7' }); }

        const insBlockMatches = [...html.matchAll(/<ins[^>]*>([\s\S]*?)<\/ins>/gi)];
        let firstIns = false;
        for (const ib of insBlockMatches) {
          if (ib[1].includes('woocommerce-Price-amount') || ib[1].includes('₪') || ib[1].includes('&#8362;')) {
            const innerText = ib[1].replace(/<[^>]+>/g, '');
            const p = cleanPrice(innerText);
            if (p) { candidates.push({ value: p, strategy: firstIns ? 'S8b' : 'S8' }); if (!firstIns) firstIns = true; }
          }
        }

        const wcMatches = [...html.matchAll(/<[^>]*class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)];
        for (const wm of wcMatches) { const p = cleanPrice(wm[1].replace(/<[^>]+>/g, '')); if (p) candidates.push({ value: p, strategy: 'S3' }); }

        // Dedupe + validate
        const seen = new Set();
        const valid = candidates.filter(c => {
          const key = `${c.value}|${c.strategy}`;
          if (seen.has(key)) return false;
          seen.add(key);
          if (c.value < 100 || c.value > 100000) return false;
          if (zapMyPrice && zapMyPrice > 0 && Math.abs(c.value - zapMyPrice) / zapMyPrice > 0.25) return false;
          return true;
        });

        if (valid.length === 0) return { ok: false, error: 'לא נמצא מחיר תקין' };

        const prio = { 'S1': 0, 'S2': 1, 'S7': 2, 'S8': 3, 'S3': 4, 'S8b': 5 };
        valid.sort((a, b) => (prio[a.strategy] ?? 99) - (prio[b.strategy] ?? 99));
        return { ok: true, price: valid[0].value };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // ─── Scrape Zap ───
    async function scrapeZap(url, storeName) {
      if (!url) return { ok: false, error: 'אין קישור Zap' };
      const sName = storeName || 'GADGET TEAM';
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'he-IL,he;q=0.9', 'Cache-Control': 'no-cache' },
          redirect: 'follow',
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const html = await res.text();

        const rowRegex = /<div[^>]*class="[^"]*compare-item-row[^"]*"[^>]*data-site-name="([^"]*)"[^>]*>/gi;
        const allRows = [];
        let match;
        while ((match = rowRegex.exec(html)) !== null) {
          const fullTag = match[0];
          const siteName = match[1];
          const priceMatch = fullTag.match(/data-product-price="([^"]*)"/);
          const indexMatch = fullTag.match(/data-index="([^"]*)"/);
          const saleTypeMatch = fullTag.match(/data-sale-type="([^"]*)"/);
          if (priceMatch && siteName) {
            const price = Math.round(parseFloat(priceMatch[1].replace(/,/g, '')));
            const index = indexMatch ? parseInt(indexMatch[1]) : 999;
            const saleType = saleTypeMatch ? parseInt(saleTypeMatch[1]) : 1;
            if (price >= 10 && price <= 100000) allRows.push({ store: siteName, price, index, saleType });
          }
        }

        const newProducts = allRows.filter(r => r.saleType === 1);
        if (newProducts.length === 0) return { ok: false, error: 'לא נמצאו מוצרים חדשים' };

        newProducts.sort((a, b) => a.index - b.index);
        const valid = newProducts.map(r => ({ store: r.store, price: r.price }));

        const lowerName = sName.toLowerCase();
        let myIdx = valid.findIndex(s => s.store.toLowerCase().includes(lowerName));
        if (myIdx === -1) {
          for (const token of ['gadget-team', 'gadget team', 'גאדג', "גאדג'ט"]) {
            myIdx = valid.findIndex(s => s.store.toLowerCase().includes(token));
            if (myIdx !== -1) break;
          }
        }
        if (myIdx === -1) return { ok: false, error: `חנות "${sName}" לא נמצאה` };

        const above = myIdx > 0 ? valid[myIdx - 1] : null;
        const below = myIdx < valid.length - 1 ? valid[myIdx + 1] : null;

        return {
          ok: true, my_position: myIdx + 1, my_price_on_zap: valid[myIdx].price,
          position_above_me_store: above?.store || null, position_above_me_price: above?.price || null,
          position_below_me_store: below?.store || null, position_below_me_price: below?.price || null,
          first_place_store: valid[0]?.store || null, first_place_price: valid[0]?.price || null,
          second_place_store: valid[1]?.store || null, second_place_price: valid[1]?.price || null,
          third_place_store: valid[2]?.store || null, third_place_price: valid[2]?.price || null,
          total_competitors: valid.length, competitors_json: JSON.stringify(valid),
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // ─── Process each product ───
    const startTime = Date.now();
    let checked = 0, alertsTotal = 0, errorsTotal = 0;
    const errorDetails = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const now = new Date().toISOString();
      try {
        // Scrape Zap
        const zap = await scrapeZap(product.zap_comparison_url, product.my_store_name_zap);
        if (!zap.ok) {
          await base44.asServiceRole.entities.ProductsMonitor.update(product.id, { last_error: zap.error, last_check_time: now, consecutive_failures: (product.consecutive_failures || 0) + 1 });
          errorsTotal++;
          errorDetails.push(`${product.product_name}: ${zap.error}`);
          continue;
        }

        // Scrape WC
        let wooPrice = zap.my_price_on_zap;
        if (product.my_woocommerce_url) {
          const woo = await scrapeWoo(product.my_woocommerce_url, zap.my_price_on_zap);
          if (woo.ok) wooPrice = woo.price;
        }

        const myPrice = wooPrice;
        const cost = product.cost_price || 0;
        const desiredPos = product.desired_position || 1;
        const minMargin = product.min_profit_margin ?? 15;
        const minAllowed = Math.ceil(cost * (1 + minMargin / 100));

        // Get previous snapshot
        let prevSnap = null;
        try {
          const prevSnaps = await base44.asServiceRole.entities.PriceSnapshot.filter({ linked_product: product.id }, '-check_timestamp', 1);
          if (prevSnaps?.length) prevSnap = prevSnaps[0];
        } catch (_) {}

        // Recommendation
        let suggested, recType;
        const competitors = JSON.parse(zap.competitors_json || '[]');
        const desiredEntry = competitors[desiredPos - 1] || null;
        const desiredPrice = desiredEntry?.price || null;

        if (zap.my_position > desiredPos) {
          const priceNeeded = desiredPrice ? desiredPrice - 1 : myPrice - 1;
          suggested = Math.max(priceNeeded, minAllowed);
          recType = priceNeeded >= minAllowed ? "הורד מחיר כדי להגיע ליעד" : "לא ניתן להגיע ליעד";
        } else if (zap.my_position === desiredPos) {
          if (zap.position_below_me_price && zap.position_below_me_price >= myPrice + 2) {
            suggested = zap.position_below_me_price - 1;
            recType = "העלה מחיר - יש מקום";
          } else { suggested = myPrice; recType = "הישאר במחיר נוכחי"; }
        } else {
          if (desiredPrice && desiredPrice - 1 > myPrice) { suggested = desiredPrice - 1; recType = "העלה מחיר - יש מקום"; }
          else { suggested = myPrice; recType = "הישאר במחיר נוכחי"; }
        }
        if (myPrice < minAllowed) recType = "אזהרה - מתחת לרווח מינימלי";
        suggested = Math.round(suggested);

        const margin = suggested > 0 ? ((suggested - cost) / suggested) * 100 : 0;
        const markupPct = cost > 0 ? Math.round(((myPrice - cost) / cost) * 1000) / 10 : null;
        const grossMargin = myPrice > 0 ? Math.round(((myPrice - cost) / myPrice) * 1000) / 10 : null;

        // Create snapshot
        const snapshot = await base44.asServiceRole.entities.PriceSnapshot.create({
          linked_product: product.id, check_timestamp: now,
          my_position: zap.my_position, total_competitors: zap.total_competitors,
          my_price_on_site: myPrice, my_price_on_zap: zap.my_price_on_zap,
          cost_price_snapshot: cost, desired_position_snapshot: desiredPos,
          first_place_price: zap.first_place_price, first_place_store: zap.first_place_store,
          second_place_price: zap.second_place_price, second_place_store: zap.second_place_store,
          third_place_price: zap.third_place_price, third_place_store: zap.third_place_store,
          position_above_me_price: zap.position_above_me_price, position_above_me_store: zap.position_above_me_store,
          position_below_me_price: zap.position_below_me_price, position_below_me_store: zap.position_below_me_store,
          desired_position_price: desiredPrice, desired_position_store: desiredEntry?.store || null,
          markup_percent: markupPct, gross_margin_percent: grossMargin,
          gap_to_first_place: zap.first_place_price ? myPrice - zap.first_place_price : null,
          competitors_json: zap.competitors_json,
          prev_snapshot: prevSnap?.id || null,
          position_delta: safeDelta(zap.my_position, prevSnap?.my_position),
          price_site_delta: safeDelta(myPrice, prevSnap?.my_price_on_site),
        });

        // Create recommendation
        const recommendation = await base44.asServiceRole.entities.PriceRecommendation.create({
          linked_product: product.id, linked_snapshot: snapshot.id,
          recommendation_time: now, current_position: zap.my_position, desired_position: desiredPos,
          recommendation_type: recType, new_suggested_price: suggested,
          profit_at_suggested_price: suggested - cost,
          margin_at_suggested_price: Math.round(margin * 10) / 10,
          gap_to_position_above: zap.position_above_me_price ? myPrice - zap.position_above_me_price : null,
          gap_to_position_below: zap.position_below_me_price ? zap.position_below_me_price - myPrice : null,
          is_margin_acceptable: suggested >= minAllowed,
          status: "חדש",
        });

        // Status
        let newStatus = "🟡 קרוב ליעד";
        if (myPrice < minAllowed) newStatus = "⚠️ רווח נמוך";
        else if (zap.my_position <= desiredPos) newStatus = "🟢 תקין";
        else if (zap.my_position > desiredPos + 2) newStatus = "🔴 רחוק מהיעד";

        await base44.asServiceRole.entities.ProductsMonitor.update(product.id, {
          last_check_time: now, last_success_time: now, consecutive_failures: 0,
          my_current_price: myPrice, current_position: zap.my_position,
          last_error: '', needs_attention: myPrice < minAllowed,
          status_code: newStatus, last_run_mode: 'אוטומטי',
          last_snapshot: snapshot.id, last_recommendation: recommendation.id,
          last_recommendation_short: recType,
        });

        console.log(`[scheduledPriceCheck] ✅ ${product.product_name}: pos #${zap.my_position}, ₪${myPrice}`);
        checked++;
      } catch (e) {
        errorsTotal++;
        errorDetails.push(`${product.product_name}: ${e.message}`);
        console.error(`[scheduledPriceCheck] ❌ ${product.product_name}: ${e.message}`);
      }
      if (i < products.length - 1) await sleep(12000);
    }

    const durationSec = Math.round((Date.now() - startTime) / 1000);

    // Write run log
    try {
      await base44.asServiceRole.entities.PriceMonitorLog.create({
        run_time: new Date().toISOString(), run_mode: 'אוטומטי',
        products_checked: checked + errorsTotal, successes: checked,
        failures: errorsTotal, alerts_created: alertsTotal,
        duration_sec: durationSec, notes: errorDetails.length > 0 ? errorDetails.join('\n') : 'הכל תקין',
      });
    } catch (_) {}

    console.log(`[scheduledPriceCheck] Done: ${checked}/${checked + errorsTotal} OK, ${durationSec}s`);
    return Response.json({ success: true, checked, errors: errorsTotal, duration_sec: durationSec });
  } catch (error) {
    console.error('[scheduledPriceCheck] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});