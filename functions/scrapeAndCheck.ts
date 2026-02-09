import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ─── helpers ───
const cleanPrice = (txt) => {
  if (!txt) return null;
  const cleaned = txt.replace(/[₪,\s]/g, '').replace(/[^\d.]/g, '');
  const n = Math.round(parseFloat(cleaned));
  return (n >= 10 && n <= 100000) ? n : null;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const PRIORITY_ORDER = { "קריטי": 0, "גבוה": 1, "בינוני": 2, "נמוך": 3 };
const safeDelta = (a, b) => (a != null && b != null) ? a - b : null;

// ─── Scrape WooCommerce ───
async function scrapeWooPrice(url) {
  if (!url) return { ok: false, error: 'אין קישור WooCommerce' };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();

    let m = html.match(/itemprop=["']price["']\s+content=["']([^"']+)["']/i);
    if (m) { const p = cleanPrice(m[1]); if (p) return { ok: true, price: p }; }

    const priceMatches = [...html.matchAll(/<(?:span|bdi)[^>]*class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>([\s\S]*?)<\/(?:span|bdi)>/gi)];
    for (const pm of priceMatches) {
      const p = cleanPrice(pm[1]);
      if (p) return { ok: true, price: p };
    }

    const genericMatch = html.match(/₪\s*([\d,]+(?:\.\d+)?)/);
    if (genericMatch) { const p = cleanPrice(genericMatch[1]); if (p) return { ok: true, price: p }; }

    return { ok: false, error: 'לא נמצא מחיר בדף WooCommerce' };
  } catch (e) {
    return { ok: false, error: `שגיאת WooCommerce: ${e.message}` };
  }
}

// ─── Scrape Zap comparison via LLM ───
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
          stores: { type: "array", items: { type: "object", properties: { store: { type: "string" }, price: { type: "number" } } } },
          error: { type: "string" }
        }
      }
    });

    const stores = result?.stores || [];
    if (!stores.length) return { ok: false, error: result?.error || 'לא נמצאו חנויות בדף Zap' };

    stores.sort((a, b) => a.price - b.price);
    const valid = stores.filter(s => s.store && s.price >= 10 && s.price <= 100000);
    if (!valid.length) return { ok: false, error: 'לא נמצאו מחירים תקינים' };

    // Priority matching: A) exact, B) fallback tokens
    const lowerName = storeName.toLowerCase();
    let myIdx = valid.findIndex(s => s.store.toLowerCase().includes(lowerName));
    if (myIdx === -1) {
      const fallbackTokens = ['gadget-team', 'gadget team', 'gadget-team.co.il', 'גאדג', "גאדג'ט"];
      for (const token of fallbackTokens) {
        myIdx = valid.findIndex(s => s.store.toLowerCase().includes(token));
        if (myIdx !== -1) break;
      }
    }
    if (myIdx === -1) {
      return { ok: false, error: `החנות שלנו ("${storeName}") לא נמצאה בדף Zap (בדוק שם חנות בזאפ). חנויות שנמצאו: ${valid.map(s => s.store).join(', ')}` };
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

  let competitors = [];
  try { competitors = JSON.parse(zapData.competitors_json || '[]'); } catch (_) {}
  const desired_entry = competitors[desired_pos - 1] || null;
  const desired_price = desired_entry?.price || null;
  const min_allowed_price = Math.ceil(cost * (1 + min_margin_pct / 100));

  let suggested, recommendation_type;

  if (my_pos > desired_pos) {
    const price_needed = desired_price ? desired_price - 1 : my_price - 1;
    suggested = Math.max(price_needed, min_allowed_price);
    recommendation_type = price_needed >= min_allowed_price ? "הורד מחיר כדי להגיע ליעד" : "לא ניתן להגיע ליעד";
  } else if (my_pos === desired_pos) {
    if (below_price && below_price >= my_price + 2) {
      suggested = below_price - 1;
      recommendation_type = "העלה מחיר - יש מקום";
    } else {
      suggested = my_price;
      recommendation_type = "הישאר במחיר נוכחי";
    }
  } else {
    if (desired_price && desired_price - 1 > my_price) {
      suggested = desired_price - 1;
      recommendation_type = "העלה מחיר - יש מקום";
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

// ─── Alert deduplication helper ───
async function isDuplicateAlert(base44, fingerprint) {
  try {
    const existing = await base44.asServiceRole.entities.PriceAlert.filter({ fingerprint }, '-alert_timestamp', 1);
    return existing && existing.length > 0;
  } catch (_) { return false; }
}

// ─── Create deduped alert ───
async function createDedupedAlert(base44, alertData) {
  if (!alertData.fingerprint) return null;
  const dup = await isDuplicateAlert(base44, alertData.fingerprint);
  if (dup) { console.log(`Alert deduped: ${alertData.fingerprint}`); return null; }
  return await base44.asServiceRole.entities.PriceAlert.create(alertData);
}

// ─── AI alert message ───
async function generateAlertMessage(base44, alertType, facts) {
  try {
    const prompt = `כתוב הודעת התראה בעברית (1–2 משפטים), עובדתית וקצרה.
אל תחשב מספרים ואל תשנה מספרים.
הצג: מה השתנה ומה ההשפעה, ומה כדאי לעשות.

סוג התראה: ${alertType}
עובדות: ${JSON.stringify(facts)}

Output ONLY Hebrew text.`;
    const r = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });
    if (typeof r === 'string' && r.length > 5) return r;
  } catch (_) {}
  return null;
}

// ─── Price war detection ───
async function detectPriceWar(base44, productId) {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const snaps = await base44.asServiceRole.entities.PriceSnapshot.filter({ linked_product: productId }, '-check_timestamp', 20);
    const recent = snaps.filter(s => s.check_timestamp >= cutoff);
    if (recent.length < 4) return false;
    let posChanges = 0;
    let priceAbsSum = 0;
    for (const s of recent) {
      if (s.position_delta != null && s.position_delta !== 0) posChanges++;
      if (s.price_site_delta != null) priceAbsSum += Math.abs(s.price_site_delta);
    }
    return posChanges >= 3 || priceAbsSum >= 100;
  } catch (_) { return false; }
}

// ─── Process single product ───
async function processProduct(base44, product, runMode) {
  const productId = product.id;
  const now = new Date().toISOString();
  const currentFailures = product.consecutive_failures || 0;

  // Helper for error handling
  const handleError = async (errMsg) => {
    const newFailCount = currentFailures + 1;
    await base44.asServiceRole.entities.ProductsMonitor.update(productId, {
      last_error: errMsg,
      needs_attention: true,
      last_check_time: now,
      consecutive_failures: newFailCount,
      last_run_mode: runMode || 'ידני',
    });

    // Only create alert for repeated failures (>=3) or first failure, deduped
    let alertCreated = 0;
    if (newFailCount >= 3) {
      const fp = `${productId}|שגיאת בדיקה חוזרת|${today()}|failures:${newFailCount}`;
      const alert = await createDedupedAlert(base44, {
        linked_product: productId,
        alert_timestamp: now,
        alert_type: "שגיאת בדיקה חוזרת",
        priority: "גבוה",
        is_read: false,
        requires_action: true,
        fingerprint: fp,
        message: `${newFailCount} כישלונות רצופים: ${errMsg}`,
      });
      if (alert) alertCreated = 1;
    }
    return { ok: false, error: errMsg, alertsCreated: alertCreated };
  };

  // 1. Scrape Zap
  const zap = await scrapeZapComparison(base44, product.zap_comparison_url, product.my_store_name_zap || 'GADGET TEAM');
  if (!zap.ok) return handleError(`שגיאת Zap: ${zap.error}`);

  // 2. Scrape Woo
  let wooPrice = null;
  if (product.my_woocommerce_url) {
    const woo = await scrapeWooPrice(product.my_woocommerce_url);
    if (!woo.ok) return handleError(`שגיאת WooCommerce: ${woo.error}`);
    wooPrice = woo.price;
  } else {
    wooPrice = zap.my_price_on_zap;
  }

  const my_price = wooPrice;
  const cost = product.cost_price || 0;
  const desired_pos = product.desired_position || 1;

  // 2b. Strict validation
  const validationErrors = [];
  if (!zap.my_position || zap.my_position < 1) validationErrors.push('מיקום לא תקין');
  if (!zap.total_competitors || zap.total_competitors < 3) validationErrors.push(`מספר מתחרים נמוך (${zap.total_competitors || 0})`);
  if (!my_price || my_price < 10 || my_price > 100000) validationErrors.push(`מחיר WooCommerce לא תקין (₪${my_price})`);
  if (!zap.my_price_on_zap || zap.my_price_on_zap < 10 || zap.my_price_on_zap > 100000) validationErrors.push(`מחיר Zap לא תקין (₪${zap.my_price_on_zap})`);
  if (validationErrors.length > 0) return handleError(`נתונים לא תקינים: ${validationErrors.join('; ')}`);

  // 3. Get previous snapshot for deltas
  let prevSnapshot = null;
  try {
    const prevSnaps = await base44.asServiceRole.entities.PriceSnapshot.filter({ linked_product: productId }, '-check_timestamp', 1);
    if (prevSnaps && prevSnaps.length > 0) prevSnapshot = prevSnaps[0];
  } catch (_) {}

  // 4. Compute deltas
  const position_delta = safeDelta(zap.my_position, prevSnapshot?.my_position);
  const price_site_delta = safeDelta(my_price, prevSnapshot?.my_price_on_site);
  const price_zap_delta = safeDelta(zap.my_price_on_zap, prevSnapshot?.my_price_on_zap);
  const above_price_delta = safeDelta(zap.position_above_me_price, prevSnapshot?.position_above_me_price);
  const below_price_delta = safeDelta(zap.position_below_me_price, prevSnapshot?.position_below_me_price);

  // 5. Recommendation
  const rec = computeRecommendation(product, my_price, zap);

  // 6. Snapshot formulas
  const markup_percent = cost > 0 ? Math.round(((my_price - cost) / cost) * 1000) / 10 : null;
  const gross_margin_percent = my_price > 0 ? Math.round(((my_price - cost) / my_price) * 1000) / 10 : null;
  const gap_to_first = zap.first_place_price ? my_price - zap.first_place_price : null;

  // 7. Create snapshot
  const snapshot = await base44.asServiceRole.entities.PriceSnapshot.create({
    linked_product: productId,
    check_timestamp: now,
    my_position: zap.my_position,
    total_competitors: zap.total_competitors,
    my_price_on_site: my_price,
    my_price_on_zap: zap.my_price_on_zap,
    cost_price_snapshot: cost,
    desired_position_snapshot: desired_pos,
    first_place_price: zap.first_place_price, first_place_store: zap.first_place_store,
    second_place_price: zap.second_place_price, second_place_store: zap.second_place_store,
    third_place_price: zap.third_place_price, third_place_store: zap.third_place_store,
    position_above_me_price: zap.position_above_me_price, position_above_me_store: zap.position_above_me_store,
    position_below_me_price: zap.position_below_me_price, position_below_me_store: zap.position_below_me_store,
    desired_position_price: rec.desired_position_price, desired_position_store: rec.desired_position_store,
    markup_percent, gross_margin_percent, gap_to_first_place: gap_to_first,
    competitors_json: zap.competitors_json,
    prev_snapshot: prevSnapshot?.id || null,
    position_delta, price_site_delta, price_zap_delta, above_price_delta, below_price_delta,
  });

  // 8. Create recommendation
  const recommendation = await base44.asServiceRole.entities.PriceRecommendation.create({
    linked_product: productId, linked_snapshot: snapshot.id,
    recommendation_time: now, current_position: zap.my_position, desired_position: desired_pos,
    recommendation_type: rec.recommendation_type,
    new_suggested_price: rec.new_suggested_price,
    profit_at_suggested_price: rec.profit_at_suggested_price,
    margin_at_suggested_price: rec.margin_at_suggested_price,
    gap_to_position_above: rec.gap_to_position_above,
    gap_to_position_below: rec.gap_to_position_below,
    is_margin_acceptable: rec.is_margin_acceptable,
    status: "חדש",
  });

  // 9. AI text for recommendation
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
${position_delta != null ? `- שינוי מיקום: ${position_delta > 0 ? '+' : ''}${position_delta}` : ''}

Write 2-4 sentences in Hebrew:
1) מה לעשות עכשיו
2) למה זה נכון ביחס ליעד ולמתחרים
3) אזהרה קצרה אם יש חריגה
Tone: ברור, ישיר, מקצועי. Output ONLY Hebrew text.`;
    const aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: aiPrompt });
    if (typeof aiResult === 'string' && aiResult.length > 5) aiText = aiResult;
  } catch (_) {}

  await base44.asServiceRole.entities.PriceRecommendation.update(recommendation.id, { recommended_action: aiText });

  // 10. Smart alerts — collect candidates, pick top 2 by priority
  const alertCandidates = [];
  const min_allowed_price = rec.min_allowed_price;
  const prevPos = prevSnapshot?.my_position;
  const d = today();

  // E) Below minimum margin
  if (my_price < min_allowed_price) {
    alertCandidates.push({
      alert_type: "מתחת לרווח מינימלי",
      priority: "קריטי",
      requires_action: true,
      fingerprint: `${productId}|מתחת לרווח מינימלי|${d}|min:${min_allowed_price}|price:${my_price}`,
      facts: { מחיר_נוכחי: my_price, מחיר_מינימלי: min_allowed_price, מוצר: product.product_name },
    });
  }

  // A) Position dropped below desired
  if (zap.my_position > desired_pos) {
    const shouldAlert = !prevPos || prevPos <= desired_pos || (position_delta != null && position_delta >= 1);
    if (shouldAlert) {
      const prio = zap.my_position >= desired_pos + 3 ? "גבוה" : "בינוני";
      alertCandidates.push({
        alert_type: "ירדנו מתחת למיקום רצוי",
        priority: prio,
        requires_action: true,
        fingerprint: `${productId}|ירדנו מתחת למיקום רצוי|${d}|pos:${prevPos || '?'}->${zap.my_position}|target:${desired_pos}`,
        facts: { מיקום_ישן: prevPos, מיקום_חדש: zap.my_position, יעד: desired_pos, מוצר: product.product_name },
      });
    }
  }

  // F) Price war
  const priceWar = await detectPriceWar(base44, productId);
  if (priceWar) {
    alertCandidates.push({
      alert_type: "מלחמת מחירים",
      priority: "גבוה",
      requires_action: true,
      fingerprint: `${productId}|מלחמת מחירים|${d}`,
      facts: { מוצר: product.product_name, מיקום: zap.my_position, מחיר: my_price },
    });
  }

  // B) Competitor above changed price
  if (above_price_delta != null && Math.abs(above_price_delta) >= 20) {
    alertCandidates.push({
      alert_type: "מתחרה מעלינו שינה מחיר",
      priority: "בינוני",
      requires_action: false,
      fingerprint: `${productId}|מתחרה מעלינו שינה מחיר|${d}|above:${prevSnapshot?.position_above_me_price}->${zap.position_above_me_price}`,
      facts: { מתחרה: zap.position_above_me_store, מחיר_ישן: prevSnapshot?.position_above_me_price, מחיר_חדש: zap.position_above_me_price, מוצר: product.product_name },
    });
  }

  // C) Competitor below changed price
  if (below_price_delta != null && Math.abs(below_price_delta) >= 20) {
    alertCandidates.push({
      alert_type: "מתחרה מתחתינו שינה מחיר",
      priority: "בינוני",
      requires_action: false,
      fingerprint: `${productId}|מתחרה מתחתינו שינה מחיר|${d}|below:${prevSnapshot?.position_below_me_price}->${zap.position_below_me_price}`,
      facts: { מתחרה: zap.position_below_me_store, מחיר_ישן: prevSnapshot?.position_below_me_price, מחיר_חדש: zap.position_below_me_price, מוצר: product.product_name },
    });
  }

  // D) Opportunity to raise price
  if (zap.my_position === desired_pos && zap.position_below_me_price && (zap.position_below_me_price - my_price) >= 50) {
    alertCandidates.push({
      alert_type: "הזדמנות להעלות מחיר",
      priority: "בינוני",
      requires_action: false,
      fingerprint: `${productId}|הזדמנות להעלות מחיר|${d}|gap:${zap.position_below_me_price - my_price}`,
      facts: { מחיר_שלנו: my_price, מחיר_מתחרה_מתחת: zap.position_below_me_price, פער: zap.position_below_me_price - my_price, מוצר: product.product_name },
    });
  }

  // Sort by priority, pick top 2
  alertCandidates.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  const topAlerts = alertCandidates.slice(0, 2);
  let alertsCreated = 0;

  for (const ac of topAlerts) {
    const msg = await generateAlertMessage(base44, ac.alert_type, ac.facts) || `${ac.alert_type}: ${JSON.stringify(ac.facts)}`;
    const alert = await createDedupedAlert(base44, {
      linked_product: productId,
      linked_recommendation: recommendation.id,
      alert_timestamp: now,
      alert_type: ac.alert_type,
      priority: ac.priority,
      is_read: false,
      requires_action: ac.requires_action,
      fingerprint: ac.fingerprint,
      old_position: prevPos || null,
      new_position: zap.my_position,
      source_snapshot: snapshot.id,
      source_prev_snapshot: prevSnapshot?.id || null,
      message: msg,
    });
    if (alert) alertsCreated++;
  }

  // 11. Update product
  let newStatus = "🟡 קרוב ליעד";
  if (my_price < min_allowed_price) newStatus = "⚠️ רווח נמוך";
  else if (zap.my_position <= desired_pos) newStatus = "🟢 תקין";
  else if (zap.my_position <= desired_pos + 2) newStatus = "🟡 קרוב ליעד";
  else newStatus = "🔴 רחוק מהיעד";

  await base44.asServiceRole.entities.ProductsMonitor.update(productId, {
    last_check_time: now,
    last_success_time: now,
    consecutive_failures: 0,
    my_current_price: my_price,
    current_position: zap.my_position,
    last_error: '',
    needs_attention: my_price < min_allowed_price,
    status_code: newStatus,
    last_recommendation_short: aiText.substring(0, 80),
    last_snapshot: snapshot.id,
    last_recommendation: recommendation.id,
    last_run_mode: runMode || 'ידני',
  });

  return {
    ok: true,
    my_position: zap.my_position,
    my_price,
    new_suggested_price: rec.new_suggested_price,
    recommendation_type: rec.recommendation_type,
    alertsCreated,
    position_delta,
  };
}

// ─── Main handler ───
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, product_id, run_mode } = body;
    const mode = run_mode || 'ידני';

    if (action === 'refresh_single') {
      if (!product_id) return Response.json({ error: 'חסר product_id' }, { status: 400 });
      const product = await base44.asServiceRole.entities.ProductsMonitor.get(product_id);
      if (!product) return Response.json({ error: 'מוצר לא נמצא' }, { status: 404 });
      if (!product.is_active) return Response.json({ success: false, error: 'המוצר לא פעיל במעקב' });

      const result = await processProduct(base44, product, mode);
      if (!result.ok) return Response.json({ success: false, error: result.error });

      const deltaStr = result.position_delta != null ? ` (${result.position_delta > 0 ? '+' : ''}${result.position_delta})` : '';
      return Response.json({
        success: true,
        message: `✅ הרענון הושלם\nמיקום: #${result.my_position}${deltaStr}\nמחיר באתר: ₪${result.my_price}\nהמלצה: ₪${result.new_suggested_price} (${result.recommendation_type})`,
        ...result,
      });
    }

    if (action === 'refresh_all') {
      const startTime = Date.now();
      const products = await base44.asServiceRole.entities.ProductsMonitor.filter({ is_active: true });
      let checked = 0, alertsTotal = 0, errorsTotal = 0;
      const errorDetails = [];

      for (let i = 0; i < products.length; i++) {
        try {
          const result = await processProduct(base44, products[i], mode);
          if (result.ok) {
            checked++;
            alertsTotal += result.alertsCreated || 0;
          } else {
            errorsTotal++;
            errorDetails.push(`${products[i].product_name}: ${result.error}`);
          }
        } catch (e) {
          console.error(`Error processing ${products[i].product_name}:`, e.message);
          errorsTotal++;
          errorDetails.push(`${products[i].product_name}: ${e.message}`);
        }
        if (i < products.length - 1) await sleep(12000);
      }

      const durationSec = Math.round((Date.now() - startTime) / 1000);

      // Write run log
      try {
        await base44.asServiceRole.entities.PriceMonitorLog.create({
          run_time: new Date().toISOString(),
          run_mode: mode,
          products_checked: checked + errorsTotal,
          successes: checked,
          failures: errorsTotal,
          alerts_created: alertsTotal,
          duration_sec: durationSec,
          notes: errorDetails.length > 0 ? errorDetails.join('\n') : 'הכל תקין',
        });
      } catch (_) { console.error('Failed to write run log'); }

      return Response.json({
        success: true,
        message: `✅ בדיקת מחירים הושלמה\nנבדקו ${checked + errorsTotal} מוצרים\nהצלחות: ${checked}\nהתראות: ${alertsTotal}\nשגיאות: ${errorsTotal}\nזמן: ${durationSec} שניות`,
        checked, alerts: alertsTotal, errors: errorsTotal, duration_sec: durationSec,
      });
    }

    return Response.json({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (error) {
    console.error('scrapeAndCheck error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});