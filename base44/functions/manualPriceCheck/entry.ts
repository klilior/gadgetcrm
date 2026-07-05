import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { product_id, my_position, total_competitors, my_price_on_site, my_price_on_zap,
      first_place_price, position_above_me_price, position_above_me_store,
      position_below_me_price, position_below_me_store,
      desired_position_price, desired_position_store } = body;

    if (!product_id || my_position == null || my_price_on_site == null) {
      return Response.json({ error: 'חסרים שדות חובה: product_id, my_position, my_price_on_site' }, { status: 400 });
    }

    // 1. Fetch product
    const product = await base44.asServiceRole.entities.ProductsMonitor.get(product_id);
    if (!product) return Response.json({ error: 'מוצר לא נמצא' }, { status: 404 });

    const cost = product.cost_price || 0;
    const min_margin_pct = product.min_profit_margin ?? 15;
    const desired_pos = product.desired_position || 1;
    const my_pos = my_position;
    const my_price = my_price_on_site;
    const below_price = position_below_me_price || null;
    const above_price = position_above_me_price || null;
    const desired_price = desired_position_price || null;

    // 2. min_allowed_price
    const min_allowed_price = Math.ceil(cost * (1 + min_margin_pct / 100));

    // 3. Helper functions
    const profit = (price) => price - cost;
    const gross_margin_pct_fn = (price) => price > 0 ? ((price - cost) / price) * 100 : 0;
    const markup_pct_fn = (price) => cost > 0 ? ((price - cost) / cost) * 100 : 0;

    // 4. Deterministic scenario
    let suggested;
    let recommendation_type;

    if (my_pos > desired_pos) {
      // Scenario A: worse than target
      const price_needed = desired_price ? desired_price - 1 : my_price - 1;
      suggested = Math.max(price_needed, min_allowed_price);
      recommendation_type = price_needed >= min_allowed_price
        ? "הורד מחיר כדי להגיע ליעד"
        : "לא ניתן להגיע ליעד";
    } else if (my_pos === desired_pos) {
      // Scenario B: at target
      if (below_price && below_price >= my_price + 2) {
        suggested = below_price - 1;
        recommendation_type = "העלה מחיר - יש מקום";
      } else {
        suggested = my_price;
        recommendation_type = "הישאר במחיר נוכחי";
      }
    } else {
      // Scenario C: better than target
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

    // 5. Margin safety override
    if (my_price < min_allowed_price) {
      recommendation_type = "אזהרה - מתחת לרווח מינימלי";
    }

    // Ensure suggested is integer
    suggested = Math.round(suggested);

    const suggested_margin = gross_margin_pct_fn(suggested);
    const is_margin_acceptable = suggested >= min_allowed_price;

    const gap_above = above_price != null ? my_price - above_price : null;
    const gap_below = below_price != null ? below_price - my_price : null;

    const now = new Date().toISOString();

    // 6. Compute snapshot formula fields
    const markup_percent = cost > 0 ? markup_pct_fn(my_price) : null;
    const gross_margin_percent = my_price > 0 ? gross_margin_pct_fn(my_price) : null;
    const gap_to_first = first_place_price ? my_price - first_place_price : null;

    // D. Create snapshot
    const snapshot = await base44.asServiceRole.entities.PriceSnapshot.create({
      linked_product: product_id,
      check_timestamp: now,
      my_position: my_pos,
      total_competitors: total_competitors || null,
      my_price_on_site: my_price,
      my_price_on_zap: my_price_on_zap || null,
      cost_price_snapshot: cost,
      desired_position_snapshot: desired_pos,
      first_place_price: first_place_price || null,
      position_above_me_price: above_price,
      position_above_me_store: position_above_me_store || null,
      position_below_me_price: below_price,
      position_below_me_store: position_below_me_store || null,
      desired_position_price: desired_price,
      desired_position_store: desired_position_store || null,
      markup_percent: markup_percent != null ? Math.round(markup_percent * 10) / 10 : null,
      gross_margin_percent: gross_margin_percent != null ? Math.round(gross_margin_percent * 10) / 10 : null,
      gap_to_first_place: gap_to_first,
      competitors_json: '',
    });

    // E. Create recommendation (without AI text yet)
    const recommendation = await base44.asServiceRole.entities.PriceRecommendation.create({
      linked_product: product_id,
      linked_snapshot: snapshot.id,
      recommendation_time: now,
      current_position: my_pos,
      desired_position: desired_pos,
      recommendation_type,
      new_suggested_price: suggested,
      profit_at_suggested_price: profit(suggested),
      margin_at_suggested_price: Math.round(suggested_margin * 10) / 10,
      gap_to_position_above: gap_above,
      gap_to_position_below: gap_below,
      is_margin_acceptable,
      status: "חדש",
    });

    // F. Deterministic recommendation text (no integration credits)
    const aiText = `${recommendation_type}. מחיר נוכחי: ₪${my_price}, מחיר מומלץ: ₪${suggested}, יעד מיקום: ${desired_pos}, מיקום נוכחי: ${my_pos} מתוך ${total_competitors || '?'}. רווח צפוי: ₪${profit(suggested)} (${Math.round(suggested_margin * 10) / 10}%).`;

    await base44.asServiceRole.entities.PriceRecommendation.update(recommendation.id, {
      recommended_action: aiText,
    });

    // G. Create alert (at most one)
    let alertData = null;
    if (my_price < min_allowed_price) {
      alertData = {
        alert_type: "מתחת לרווח מינימלי",
        priority: "קריטי",
        requires_action: true,
      };
    } else if (my_pos > desired_pos) {
      alertData = {
        alert_type: "ירדנו מתחת למיקום רצוי",
        priority: "גבוה",
        requires_action: true,
      };
    } else if (my_pos < desired_pos) {
      alertData = {
        alert_type: "המיקום שלנו השתפר",
        priority: "בינוני",
        requires_action: false,
      };
    }

    let createdAlert = null;
    if (alertData) {
      // Deterministic alert message (no integration credits)
      const alertMsg = `${alertData.alert_type} — ${product.product_name}. מיקום: ${my_pos} (יעד ${desired_pos}), מחיר נוכחי: ₪${my_price}, מומלץ: ₪${suggested}. מומלץ לבדוק ולעדכן מחיר בהתאם.`;

      createdAlert = await base44.asServiceRole.entities.PriceAlert.create({
        linked_product: product_id,
        linked_recommendation: recommendation.id,
        alert_timestamp: now,
        alert_type: alertData.alert_type,
        old_position: null,
        new_position: my_pos,
        message: alertMsg,
        priority: alertData.priority,
        is_read: false,
        requires_action: alertData.requires_action,
      });
    }

    // H. Update product
    // Determine new status_code
    let newStatus = "🟡 קרוב ליעד";
    if (my_price < min_allowed_price) {
      newStatus = "⚠️ רווח נמוך";
    } else if (my_pos <= desired_pos) {
      newStatus = "🟢 תקין";
    } else if (my_pos > desired_pos + 2) {
      newStatus = "🔴 רחוק מהיעד";
    }

    await base44.asServiceRole.entities.ProductsMonitor.update(product_id, {
      my_current_price: my_price,
      last_check_time: now,
      status_code: newStatus,
    });

    return Response.json({
      success: true,
      message: `✅ הבדיקה הידנית הושלמה\nמיקום: #${my_pos}\nהמלצה: ₪${suggested} • ${recommendation_type}`,
      snapshot_id: snapshot.id,
      recommendation_id: recommendation.id,
      alert_id: createdAlert?.id || null,
      recommendation_type,
      new_suggested_price: suggested,
      new_status: newStatus,
    });
  } catch (error) {
    console.error('manualPriceCheck error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});