import { base44 } from "@/api/base44Client";

/**
 * Safely run a query with retry on rate limit
 */
async function safeQuery(label, queryFn, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const result = await queryFn();
            return result || [];
        } catch (e) {
            const is429 = e?.message?.includes('429') || e?.message?.includes('Rate limit');
            if (is429 && attempt < retries) {
                const delay = 1000 * (attempt + 1);
                console.warn(`[CustomerData] ⏳ ${label} rate limited, retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            console.error(`[CustomerData] ❌ ${label} failed:`, e?.message || e);
            return [];
        }
    }
    return [];
}

/**
 * Small delay helper to space out API calls
 */
function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Load all data for a customer card.
 * Uses phased loading with small delays between phases to avoid rate limits.
 */
export async function loadAllCustomerData(customerId, customerData) {
    if (!customerId) return null;

    const phone = customerData?.phone;
    const linetAccountId = customerData?.linet_account_id;

    // Build phone variants for activity search
    const phoneVariants = [];
    if (phone) {
        const digits = phone.replace(/[^\d]/g, '');
        phoneVariants.push(phone, digits);
        if (digits.startsWith('0') && digits.length === 10) {
            phoneVariants.push('972' + digits.slice(1));
            phoneVariants.push('+972' + digits.slice(1));
        }
    }

    // === PHASE 1: Core data (3 parallel queries) ===
    const [orders, tickets, repairs] = await Promise.all([
        safeQuery('Orders', () => base44.entities.Order.filter({ client_id: customerId }, '-order_date', 200)),
        safeQuery('Tickets', () => base44.entities.Ticket.filter({ customer_id: customerId }, '-created_date', 200)),
        safeQuery('Repairs', () => base44.entities.Repair.filter({ client_id: customerId }, '-created_date', 200)),
    ]);

    await delay(300);

    // === PHASE 2: Secondary data (4 parallel queries) ===
    const [devices, smsLogs, invoicesByClient, shipments] = await Promise.all([
        safeQuery('Devices', () => base44.entities.RepairDevice.filter({ client_id: customerId }, '-created_date', 100)),
        phone
            ? safeQuery('SMS', () => base44.entities.NotificationLog.filter({ to_phone: phone }, '-sent_at', 50))
            : Promise.resolve([]),
        safeQuery('Invoices', () => base44.entities.SalesTransaction.filter({ client_id: customerId }, '-issue_date', 200)),
        safeQuery('Shipments', () => base44.entities.Shipment.filter({ client_id: customerId }, '-created_date', 100)),
    ]);

    await delay(300);

    // === PHASE 2b: SuperPharm orders (by phone or name) ===
    let spOrders = [];
    if (phone) {
        spOrders = await safeQuery('SP-Orders', () => base44.entities.SuperPharmOrder.filter({ customer_phone: phone }, '-created_at_mirakl', 100));
    }
    if (spOrders.length === 0 && customerData?.full_name) {
        // Try matching by first name from full_name
        const firstName = customerData.full_name.split(' ')[0];
        if (firstName && firstName.length >= 2) {
            const allSP = await safeQuery('SP-Orders-name', () => base44.entities.SuperPharmOrder.list('-created_at_mirakl', 200));
            spOrders = allSP.filter(sp => {
                const spFullName = `${sp.customer_first_name || ''} ${sp.customer_last_name || ''}`.trim().toLowerCase();
                return spFullName && customerData.full_name.toLowerCase() === spFullName;
            });
        }
    }

    await delay(200);

    // === PHASE 3: Additional invoices by linet + calls ===
    let invoicesByLinet = [];
    if (linetAccountId) {
        invoicesByLinet = await safeQuery('Invoices-linet', () => 
            base44.entities.SalesTransaction.filter({ linet_account_id: linetAccountId }, '-issue_date', 200)
        );
    }

    // Merge and deduplicate invoices
    const invoiceMap = {};
    [...invoicesByClient, ...invoicesByLinet].forEach(inv => { invoiceMap[inv.id] = inv; });
    const invoices = Object.values(invoiceMap);

    await delay(300);

    // === PHASE 4: Activity search (calls by phone) ===
    let callActivities = [];
    if (phoneVariants.length > 0) {
        const [incoming, outgoing] = await Promise.all([
            safeQuery('Calls-in', () => base44.entities.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 500)),
            safeQuery('Calls-out', () => base44.entities.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 500)),
        ]);
        const allCalls = [...incoming, ...outgoing];
        callActivities = allCalls.filter(a => {
            const content = a.content || '';
            return phoneVariants.some(v => content.includes(v));
        });
    }

    await delay(200);

    // === PHASE 5: Ticket-linked activities ===
    const ticketIds = tickets.map(t => t.id);
    let ticketActivities = [];
    if (ticketIds.length > 0) {
        const allActs = await safeQuery('Ticket-acts', () => base44.entities.Activity.filter({}, '-created_date', 500));
        ticketActivities = allActs.filter(a =>
            ticketIds.includes(a.ticket_id) || ticketIds.includes(a.order_id)
        );
    }

    // Merge and deduplicate activities
    const activityMap = {};
    [...callActivities, ...ticketActivities].forEach(a => { activityMap[a.id] = a; });
    const activities = Object.values(activityMap).sort((a, b) =>
        new Date(b.created_date) - new Date(a.created_date)
    );

    // === Compute stats ===
    const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
    const spTotalSpent = spOrders.reduce((sum, o) => sum + (o.total_price || 0), 0);
    const stats = {
        totalOrders: orders.length,
        totalSpent: totalSpent + spTotalSpent,
        totalTickets: tickets.length,
        totalRepairs: repairs.length,
        totalShipments: shipments.length,
        spOrdersCount: spOrders.length,
        lastOrderDate: orders.length > 0 ? orders[0].order_date : (spOrders.length > 0 ? spOrders[0].created_at_mirakl : null),
        lastContactDate: tickets.length > 0 ? tickets[0].created_date : null,
        smsCount: smsLogs.length,
    };

    console.log(`[CustomerData] 📊 ${customerData?.full_name || customerId}: orders=${orders.length}, spOrders=${spOrders.length}, shipments=${shipments.length}, tickets=${tickets.length}, repairs=${repairs.length}, calls=${callActivities.length}, invoices=${invoices.length}, devices=${devices.length}, sms=${smsLogs.length}`);

    return { orders, tickets, repairs, devices, smsLogs, invoices, activities, stats, shipments, spOrders };
}