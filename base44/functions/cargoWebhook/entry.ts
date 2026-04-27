import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CARGO_STATUS_MAP = {
  1: 'פתוח',
  2: 'הועבר לשליח',
  3: 'נמסר',
  4: 'נאסף על ידי קארגו',
  5: 'חזרה ממשלוח כפול',
  7: 'אושר לביצוע',
  8: 'בוטל',
  9: 'משלוח שני',
  12: 'ממתין למשלוח',
  25: 'במחסן',
  50: 'בדרך למסירה',
  51: 'בדרך לנקודת חלוקה',
  52: 'נקודת חלוקה',
  55: 'בנקודת חלוקה',
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    
    console.log('📦 Cargo webhook received:', JSON.stringify(body).slice(0, 1000));

    const shipment_id = body.shipment_id || body.id;
    const status_code = body.status || body.shipment_status;

    if (!shipment_id) {
      console.warn('⚠️ Cargo webhook: no shipment_id in payload');
      return Response.json({ ok: true, message: 'no shipment_id' });
    }

    const statusText = CARGO_STATUS_MAP[status_code] || `קוד ${status_code}`;

    // Find matching Shipment
    const shipments = await base44.asServiceRole.entities.Shipment.filter({ cargo_shipment_id: String(shipment_id) });
    
    if (shipments.length > 0) {
      const shipment = shipments[0];
      await base44.asServiceRole.entities.Shipment.update(shipment.id, {
        cargo_status: String(status_code),
        cargo_status_text: statusText,
        status: status_code === 3 ? 'delivered' : status_code === 8 ? 'cancelled' : status_code === 50 ? 'in_transit' : shipment.status,
      });

      // Log activity if client exists
      if (shipment.client_id) {
        try {
          await base44.asServiceRole.entities.Activity.create({
            summary: `עדכון סטטוס משלוח קארגו #${shipment_id}: ${statusText}`,
            activity_type: 'שינוי סטטוס',
            ticket_id: '',
            order_id: shipment.order_id || '',
            content: `משלוח קארגו #${shipment_id} עודכן לסטטוס: ${statusText} (קוד: ${status_code})`,
          });
        } catch (e) {
          console.warn('⚠️ Failed to create activity log:', e.message);
        }
      }

      console.log(`✅ Updated shipment ${shipment.id} cargo_status to ${statusText}`);
    } else {
      console.warn(`⚠️ No shipment found for cargo_shipment_id: ${shipment_id}`);
    }

    return Response.json({ ok: true });

  } catch (error) {
    console.error('❌ Cargo webhook error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});