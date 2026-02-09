import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ─── helpers ───
const cleanPrice = (txt) => {
  if (!txt) return null;
  const cleaned = txt.replace(/[₪,\s]/g, '').replace(/[^\d.]/g, '');
  const n = Math.round(parseFloat(cleaned));
  return (n >= 10 && n <= 100000) ? n : null;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Scrape WooCommerce price via fetch + regex ───
async function scrapeWooPrice(url) {
  if (!url) return { ok: false, error: 'אין קישור WooCommerce' };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();

    // Try multiple patterns
    // 1) <meta itemprop="price" content="...">
    let m = html.match(/itemprop=["']price["']\s+content=["']([^"']+)["']/i);
    if (m) { const p = cleanPrice(m[1]); if (p) return { ok: true, price: p }; }

    // 2) <span class="woocommerce-Price-amount ...">...₪</span>  (last one = current)
    const priceMatches = [...html.matchAll(/<(?:span|bdi)[^>]*class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>([\s\S]*?)<\/(?:span|bdi)>/gi)];
    for (const pm of priceMatches) {
      const p = cleanPrice(pm[1]);
      if (p) return { ok: true, price: p };
    }

    // 3) Generic ₪ pattern near "price"
    const genericMatch = html.match(/₪\s*([\d,]+(?:\.\d+)?)/);
    if (genericMatch) { const p = cleanPrice(genericMatch[1]); if (p) return { ok: true, price: p }; }

    return { ok: false, error: 'לא נמצא מחיר בדף WooCommerce' };
  } catch (e) {
    return { ok: false, error: `שגיאת WooCommerce: ${e.message}` };
  }
}

// ─── Scrape Zap comparison via LLM with internet context ───
async function scrapeZapComparison(base44, url, myStoreName) {
  if (!url) return { ok: false, error: 'אין קישור Zap' };
  const storeName = myStoreName || 'GADGET TEAM';

  try {
    const prompt = `You are a data extraction bot. Go to this Zap.co.il price comparison page and extract ALL store listings with their prices.

URL: ${url}

IMPORTANT INSTRUCTIONS:
1. Extract EVERY store/retailer listing on the page with their price in ILS
2. Return ONLY a valid JSON object, no other text
3. Sort by price ascending (cheapest first)
4. Clean prices to integers (no decimals, no ₪ symbol)
5. Store names should be exactly as shown on the page

Return this exact JSON format:
{
  "stores": [
    {"store": "Store Name", "price": 1234},
    {"store": "Another Store", "price": 1299}
  ]
}

If the page cannot be loaded or no stores found, return:
{"stores": [], "error": "description"}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          stores: {
            type: "array",
            items: {
              type: "object",
              properties: {
                store: { type: "string" },
                price: { type: "number" }
              }
            }
          },
          error: { type: "string" }
        }
      }
    });

    const stores = result?.stores || [];
    if (!stores.length) {
      return { ok: false, error: result?.error || 'לא נמצאו חנויות בדף Zap' };
    }

    // Sort ascending by price
    stores.sort((a, b) => a.price - b.price);

    // Filter out invalid
    const valid = stores.filter(s => s.store && s.price >= 10 && s.price <= 100000);
    if (!valid.length) return { ok: false, error: 'לא נמצאו מחירים תקינים' };

    // Find our store
    const lowerName = storeName.toLowerCase();
    const aliases = ['gadget', 'gadget-team', 'gadget team', 'גאדג', 'גדג\'ט', 'גאג\'ט'];
    let myIdx = valid.findIndex(s => s.store.toLowerCase().includes(lowerName));
    if (myIdx === -1) {
      for (const alias of aliases) {
        myIdx = valid.findIndex(s => s.store.toLowerCase().includes(alias));
        if (myIdx !== -1) break;
      }
    }

    if (myIdx === -1) {
      return { ok: false, error: `החנות שלנו ("${storeName}") לא נמצאה בדף Zap. חנויות שנמצאו: ${valid.map(s => s.store).join(', ')}` };
    }

    const above = myIdx > 0 ? valid[myIdx - 1] : null;
    const below = myIdx < valid.length - 1 ? valid[myIdx + 1] : null;

    return {
      ok: true,
      my_position: myIdx + 1,
      my_price_on_zap: valid[myIdx].price,
      position_above_me_store: above?.store || null,
      position_above_me_price: above?.price || null,
      position_below_me_store: below?.store || null,
      position_below_me_price: below?.price || null,
      first_place_store: valid[0]?.store || null,
      first_place_price: valid[0]?.price || null,
      second_place_store: valid[1]?.store || null,
      second_place_price: valid[1]?.price || null,
      third_place_store: valid[2]?.store || null,
      third_place_price: valid[2]?.price || null,
      total_competitors: valid.length,
      competitors_json: JSON.stringify(valid),
    };
  } catch (e) {
    return { ok: false, error: `שגיאת Zap scraping: ${e.message}` };
  }
}

// ─── Deterministic recommendation engine ───
function computeRecommendation(product, my_price, zapData) {
  const cost = product.cost_price || 0;
  const min_margin_pct = product.min_profit_margin ?? 15;
  const desired_pos = product.desired_position || 1;
  const my_pos = zapData.my_position;
  const below_price = zapData.position_below_me_price;
  const above_price = zapData.position_above_me_price;

  // desired_position_price from sorted competitors
  let competitors = [];
  try { competitors = JSON.parse(zapData.competitors_json || '[]'); } catch (_) {}
  const desired_entry = competitors[desired_pos - 1] || null;
  const desired_price = desired_entry?.price || null;

  const min_allowed_price = Math.ceil(cost * (1 + min_margin_pct / 100));

  let suggested, recommendation_type;

  if (my_pos > desired_pos) {
    const price_needed = desired_price ? desired_price - 1 : my_price - 1;
    suggested = Math.max(price_needed, min_allowed_price);
    recommendation_type = price_needed >= min_allowed_price
      ? "הורד מחיר כדי להגיע ליעד"
      : "לא ניתן להגיע ליעד";
  } else if (my_pos === desired_pos) {
    if (below_price && below_price >= my_price + 2) {
      suggested = below_price - 1;
      recommendation_type = "העלה מחיר - יש מקום";
    } else {
      suggested = my_price;
      recommendation_type = "הישאר במחיר נוכחי";
    }
  } else {
    if (desired_price) {
      const max_price_at_target = desired_price - 1;
      if (max_price_at_target > my_price) {
        suggested = max_price_at_target;
        recommendation_type = "העלה מחיר - יש מקום";
      } else {
        suggested = my_price;
        recommendation_type = "הישאר במחיר נוכחי";
      }
    } else {
      suggested = my_price;
      recommendation_type = "הישאר במחיר נוכחי";
    }
  }

  if (my_price < min_allowed_price) {
    recommendation_type = "אזהרה - מתחת לרווח מינימלי";
  }

  suggested = Math.round(suggested);
  const suggested_margin = suggested > 0 ? ((suggested - cost) / suggested) * 100 : 0;

  return {
    recommendation_type,
    new_suggested_price: suggested,
    profit_at_suggested_price: suggested - cost,
    margin_at_suggested_price: Math.round(suggested_margin * 10) / 10,
    gap_to_position_above: above_price != null ? my_price - above_price : null,
    gap_to_position_below: below_price != null ? below_price - my_price : null,
    is_margin_acceptable: suggested >= min_allowed_price,
    min_allowed_price,
    desired_position_price: desired_price,
    desired_position_store: desired_entry?.store || null,
  };
}

// ─── Process single product ───
async function processProduct(base44, product) {
  const productId = product.id;
  const now = new Date().toISOString();
  const errors = [];

  // 1. Scrape Zap
  const zap = await scrapeZapComparison(base44, product.zap_comparison_url, product.my_store_name_zap || 'GADGET TEAM');
  if (!zap.ok) {
    await base44.asServiceRole.entities.ProductsMonitor.update(productId, {
      last_error: zap.error,
      needs_attention: true,
      last_check_time: now,
    });
    await base44.asServiceRole.entities.PriceAlert.create({
      linked_product: productId,
      alert_timestamp: now,
      alert_type: "מלחמת מחירים",
      priority: "גבוה",
      is_read: false,
      requires_action: true,
      message: `שגיאה בבדיקת Zap: ${zap.error}`,
    });
    return { ok: false, error: zap.error, alertCreated: true };
  }

  // 2. Scrape Woo
  let wooPrice = null;
  if (product.my_woocommerce_url) {
    const woo = await scrapeWooPrice(product.my_woocommerce_url);
    if (!woo.ok) {
      await base44.asServiceRole.entities.ProductsMonitor.update(productId, {
        last_error: woo.error,
        needs_attention: true,
        last_check_time: now,
      });
      await base44.asServiceRole.entities.PriceAlert.create({
        linked_product: productId,
        alert_timestamp: now,
        alert_type: "מלחמת מחירים",
        priority: "גבוה",
        is_read: false,
        requires_action: true,
        message: `שגיאה בבדיקת מחיר באתר: ${woo.error}`,
      });
      return { ok: false, error: woo.error, alertCreated: true };
    }
    wooPrice = woo.price;
  } else {
    // No woo URL - use zap price as site price
    wooPrice = zap.my_price_on_zap;
  }

  const my_price = wooPrice;
  const cost = product.cost_price || 0;
  const min_margin_pct = product.min_profit_margin ?? 15;
  const desired_pos = product.desired_position || 1;

  // 3. Compute recommendation
  const rec = computeRecommendation(product, my_price, zap);

  // 4. Snapshot formulas
  const markup_percent = cost > 0 ? Math.round(((my_price - cost) / cost) * 1000) / 10 : null;
  const gross_margin_percent = my_price > 0 ? Math.round(((my_price - cost) / my_price) * 1000) / 10 : null;
  const gap_to_first = zap.first_place_price ? my_price - zap.first_place_price : null;

  // 5. Create snapshot
  const snapshot = await base44.asServiceRole.entities.PriceSnapshot.create({
    linked_product: productId,
    check_timestamp: now,
    my_position: zap.my_position,
    total_competitors: zap.total_competitors,
    my_price_on_site: my_price,
    my_price_on_zap: zap.my_price_on_zap,
    cost_price_snapshot: cost,
    desired_position_snapshot: desired_pos,
    first_place_price: zap.first_place_price,
    first_place_store: zap.first_place_store,
    second_place_price: zap.second_place_price,
    second_place_store: zap.second_place_store,
    third_place_price: zap.third_place_price,
    third_place_store: zap.third_place_store,
    position_above_me_price: zap.position_above_me_price,
    position_above_me_store: zap.position_above_me_store,
    position_below_me_price: zap.position_below_me_price,
    position_below_me_store: zap.position_below_me_store,
    desired_position_price: rec.desired_position_price,
    desired_position_store: rec.desired_position_store,
    markup_percent,
    gross_margin_percent,
    gap_to_first_place: gap_to_first,
    competitors_json: zap.competitors_json,
  });

  // 6. Create recommendation
  const recommendation = await base44.asServiceRole.entities.PriceRecommendation.create({
    linked_product: productId,
    linked_snapshot: snapshot.id,
    recommendation_time: now,
    current_position: zap.my_position,
    desired_position: desired_pos,
    recommendation_type: rec.recommendation_type,
    new_suggested_price: rec.new_suggested_price,
    profit_at_suggested_price: rec.profit_at_suggested_price,
    margin_at_suggested_price: rec.margin_at_suggested_price,
    gap_to_position_above: rec.gap_to_position_above,
    gap_to_position_below: rec.gap_to_position_below,
    is_margin_acceptable: rec.is_margin_acceptable,
    status: "חדש",
  });

  // 7. AI text
  let aiText = rec.recommendation_type;
  try {
    const aiPrompt = `You are writing a pricing recommendation in Hebrew for an Israeli electronics retailer.
IMPORTANT: All numbers are already calculated. Do NOT change numbers. Do NOT perform calculations.

Data:
- מוצר: ${product.product_name}
- מיקום נוכחי: ${zap.my_position} מתוך ${zap.total_competitors}
- יעד: ${desired_pos}
- מחיר נוכחי באתר: ₪${my_price}
- מחיר מומלץ: ₪${rec.new_suggested_price}
- רווח צפוי ליחידה: ₪${rec.profit_at_suggested_price}
- מרווח רווח צפוי: ${rec.margin_at_suggested_price}%
- מחיר מינימלי מותר: ₪${rec.min_allowed_price}
- סוג המלצה: ${rec.recommendation_type}
${zap.position_above_me_price ? `- מתחרה מעל: ₪${zap.position_above_me_price} (${zap.position_above_me_store})` : ''}
${zap.position_below_me_price ? `- מתחרה מתחת: ₪${zap.position_below_me_price} (${zap.position_below_me_store})` : ''}

Write 2-4 sentences in Hebrew:
1) מה לעשות עכשיו
2) למה זה נכון ביחס ליעד ולמתחרים
3) אזהרה קצרה אם יש חריגה
Tone: ברור, ישיר, מקצועי. Output ONLY Hebrew text.`;
    const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: aiPrompt });
    if (typeof aiResult === 'string' && aiResult.length > 5) aiText = aiResult;
  } catch (_) {}

  await base44.asServiceRole.entities.PriceRecommendation.update(recommendation.id, {
    recommended_action: aiText,
  });

  // 8. Alerts
  const min_allowed_price = rec.min_allowed_price;
  let alertsCreated = 0;

  if (my_price < min_allowed_price) {
    let msg = `מתחת לרווח מינימלי: מחיר ₪${my_price}, מינימום ₪${min_allowed_price}`;
    try {
      const a = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `Write 1-2 sentence Hebrew alert. Alert: מתחת לרווח מינימלי. Product: ${product.product_name}. Price: ₪${my_price}, Min allowed: ₪${min_allowed_price}. Output ONLY Hebrew.`
      });
      if (typeof a === 'string' && a.length > 5) msg = a;
    } catch (_) {}
    await base44.asServiceRole.entities.PriceAlert.create({
      linked_product: productId, linked_recommendation: recommendation.id,
      alert_timestamp: now, alert_type: "מתחת לרווח מינימלי",
      priority: "קריטי", is_read: false, requires_action: true,
      new_position: zap.my_position, message: msg,
    });
    alertsCreated++;
  }

  if (zap.my_position > desired_pos) {
    let msg = `המיקום ירד ל-${zap.my_position}, היעד הוא ${desired_pos}`;
    try {
      const a = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `Write 1-2 sentence Hebrew alert. Alert: ירדנו מתחת למיקום רצוי. Product: ${product.product_name}. Position: ${zap.my_position}, Target: ${desired_pos}. Output ONLY Hebrew.`
      });
      if (typeof a === 'string' && a.length > 5) msg = a;
    } catch (_) {}
    await base44.asServiceRole.entities.PriceAlert.create({
      linked_product: productId, linked_recommendation: recommendation.id,
      alert_timestamp: now, alert_type: "ירדנו מתחת למיקום רצוי",
      priority: "גבוה", is_read: false, requires_action: true,
      new_position: zap.my_position, message: msg,
    });
    alertsCreated++;
  } else if (zap.my_position < desired_pos) {
    await base44.asServiceRole.entities.PriceAlert.create({
      linked_product: productId, linked_recommendation: recommendation.id,
      alert_timestamp: now, alert_type: "המיקום שלנו השתפר",
      priority: "בינוני", is_read: false, requires_action: false,
      new_position: zap.my_position, message: `המיקום שלנו השתפר ל-${zap.my_position}, היעד הוא ${desired_pos}`,
    });
    alertsCreated++;
  }

  // 9. Update product
  let newStatus = "🟡 קרוב ליעד";
  if (my_price < min_allowed_price) newStatus = "⚠️ רווח נמוך";
  else if (zap.my_position <= desired_pos) newStatus = "🟢 תקין";
  else if (zap.my_position <= desired_pos + 2) newStatus = "🟡 קרוב ליעד";
  else newStatus = "🔴 רחוק מהיעד";

  await base44.asServiceRole.entities.ProductsMonitor.update(productId, {
    last_check_time: now,
    my_current_price: my_price,
    current_position: zap.my_position,
    last_error: '',
    needs_attention: my_price < min_allowed_price,
    status_code: newStatus,
    last_recommendation_short: aiText.substring(0, 80),
  });

  return {
    ok: true,
    my_position: zap.my_position,
    my_price,
    new_suggested_price: rec.new_suggested_price,
    recommendation_type: rec.recommendation_type,
    alertsCreated,
  };
}

// ─── Main handler ───
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, product_id } = body;

    // Single product refresh
    if (action === 'refresh_single') {
      if (!product_id) return Response.json({ error: 'חסר product_id' }, { status: 400 });
      const product = await base44.asServiceRole.entities.ProductsMonitor.get(product_id);
      if (!product) return Response.json({ error: 'מוצר לא נמצא' }, { status: 404 });
      if (!product.is_active) return Response.json({ success: false, error: 'המוצר לא פעיל במעקב' });

      const result = await processProduct(base44, product);
      if (!result.ok) {
        return Response.json({ success: false, error: result.error });
      }
      return Response.json({
        success: true,
        message: `✅ הרענון הושלם\nמיקום: #${result.my_position}\nמחיר באתר: ₪${result.my_price}\nהמלצה: ₪${result.new_suggested_price} (${result.recommendation_type})`,
        ...result,
      });
    }

    // Refresh all active products
    if (action === 'refresh_all') {
      const products = await base44.asServiceRole.entities.ProductsMonitor.filter({ is_active: true });
      let checked = 0, alertsTotal = 0, errorsTotal = 0;

      for (let i = 0; i < products.length; i++) {
        try {
          const result = await processProduct(base44, products[i]);
          if (result.ok) {
            checked++;
            alertsTotal += result.alertsCreated || 0;
          } else {
            errorsTotal++;
          }
        } catch (e) {
          console.error(`Error processing ${products[i].product_name}:`, e.message);
          errorsTotal++;
        }
        // Delay between products (except last)
        if (i < products.length - 1) {
          await sleep(12000);
        }
      }

      return Response.json({
        success: true,
        message: `✅ בדיקת מחירים הושלמה\nנבדקו ${checked} מוצרים\nנוצרו ${alertsTotal} התראות חדשות\nשגיאות: ${errorsTotal}`,
        checked,
        alerts: alertsTotal,
        errors: errorsTotal,
      });
    }

    return Response.json({ error: 'פעולה לא מוכרת. השתמש ב-refresh_single או refresh_all' }, { status: 400 });
  } catch (error) {
    console.error('scrapeAndCheck error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});