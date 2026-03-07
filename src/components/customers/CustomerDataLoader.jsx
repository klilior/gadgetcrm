import { base44 } from "@/api/base44Client";

/**
 * Safely run a query and return [] on failure
 */
async function safeQuery(label, queryFn) {
    try {
        const result = await queryFn();
        console.log(`[CustomerData] ✅ ${label}: ${(result || []).length} results`);
        return result || [];
    } catch (e) {
        console.error(`[CustomerData] ❌ ${label} failed:`, e?.message || e);
        return [];
    }
}

/**
 * Load all data for a customer card.
 * Every query is isolated - a failure in one won't affect others.
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

    // === PHASE 1: All direct queries in parallel ===
    const [orders, tickets, repairs, devices, smsLogs, invoicesByClient, invoicesByLinet] = await Promise.all([
        safeQuery('Orders', () => base44.entities.Order.filter({ client_id: customerId }, '-order_date', 200)),
        safeQuery('Tickets', () => base44.entities.Ticket.filter({ customer_id: customerId }, '-created_date', 200)),
        safeQuery('Repairs', () => base44.entities.Repair.filter({ client_id: customerId }, '-created_date', 200)),
        safeQuery('Devices', () => base44.entities.RepairDevice.filter({ client_id: customerId }, '-created_date', 100)),
        phone
            ? safeQuery('SMS', () => base44.entities.NotificationLog.filter({ to_phone: phone }, '-sent_at', 50))
            : Promise.resolve([]),
        safeQuery('Invoices by client', () => base44.entities.SalesTransaction.filter({ client_id: customerId }, '-issue_date', 200)),
        linetAccountId
            ? safeQuery('Invoices by linet', () => base44.entities.SalesTransaction.filter({ linet_account_id: linetAccountId }, '-issue_date', 200))
            : Promise.resolve([]),
    ]);

    // Merge and deduplicate invoices
    const invoiceMap = {};
    [...invoicesByClient, ...invoicesByLinet].forEach(inv => { invoiceMap[inv.id] = inv; });
    const invoices = Object.values(invoiceMap);

    // === PHASE 2: Activity search (calls by phone) ===
    let callActivities = [];
    if (phoneVariants.length > 0) {
        const [incoming, outgoing] = await Promise.all([
            safeQuery('Calls incoming', () => base44.entities.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 500)),
            safeQuery('Calls outgoing', () => base44.entities.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 500)),
        ]);
        const allCalls = [...incoming, ...outgoing];
        callActivities = allCalls.filter(a => {
            const content = a.content || '';
            return phoneVariants.some(v => content.includes(v));
        });
    }

    // Ticket-linked activities
    const ticketIds = tickets.map(t => t.id);
    let ticketActivities = [];
    if (ticketIds.length > 0) {
        const allActs = await safeQuery('Ticket activities', () => base44.entities.Activity.filter({}, '-created_date', 500));
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
    const stats = {
        totalOrders: orders.length,
        totalSpent,
        totalTickets: tickets.length,
        totalRepairs: repairs.length,
        lastOrderDate: orders.length > 0 ? orders[0].order_date : null,
        lastContactDate: tickets.length > 0 ? tickets[0].created_date : null,
        smsCount: smsLogs.length,
    };

    console.log(`[CustomerData] 📊 Summary for ${customerData?.full_name || customerId}: orders=${orders.length}, tickets=${tickets.length}, repairs=${repairs.length}, calls=${callActivities.length}, invoices=${invoices.length}, devices=${devices.length}, sms=${smsLogs.length}`);

    return { orders, tickets, repairs, devices, smsLogs, invoices, activities, stats };
}