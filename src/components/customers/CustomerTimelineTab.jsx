import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, ShoppingCart, FileText, Wrench, MessageCircle, Send, Truck, Package, RotateCcw, Repeat } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

function formatDate(dateString) {
    if (!dateString) return 'אין מידע';
    try {
        return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: he });
    } catch {
        return 'תאריך לא תקין';
    }
}

function shipmentTypeInfo(type) {
    const map = {
        pickup_drop: { title: 'החזרת UPS PICKUP DROP', icon: RotateCcw, color: 'text-orange-600 bg-orange-50' },
        cargo_return: { title: 'החזרת קארגו', icon: RotateCcw, color: 'text-orange-600 bg-orange-50' },
        cargo_exchange: { title: 'החלפת קארגו', icon: Repeat, color: 'text-purple-600 bg-purple-50' },
        cargo_delivery: { title: 'משלוח קארגו', icon: Truck, color: 'text-cyan-600 bg-cyan-50' },
        pickup_point: { title: 'משלוח UPS לנקודת איסוף', icon: Truck, color: 'text-cyan-600 bg-cyan-50' },
        standard: { title: 'משלוח UPS', icon: Truck, color: 'text-cyan-600 bg-cyan-50' },
    };
    return map[type] || { title: 'משלוח', icon: Truck, color: 'text-cyan-600 bg-cyan-50' };
}

export default function CustomerTimelineTab({ orders, tickets, repairs, activities, smsLogs, invoices, shipments, spOrders }) {
    const timeline = useMemo(() => {
        const events = [];

        (orders || []).forEach(order => {
            events.push({
                type: 'order', date: order.order_date,
                title: `הזמנה #${order.external_order_number}`,
                description: `סכום: ₪${order.total}`,
                icon: ShoppingCart, color: 'text-green-600 bg-green-50'
            });
            if (order.tracking_number) {
                events.push({
                    type: 'order-tracking', date: order.updated_date || order.order_date,
                    title: `מספר מעקב להזמנה #${order.external_order_number}`,
                    description: `${order.tracking_carrier || ''} • ${order.tracking_number}`,
                    icon: Truck, color: 'text-cyan-600 bg-cyan-50'
                });
            }
        });

        (tickets || []).forEach(ticket => {
            events.push({
                type: 'ticket', date: ticket.created_date,
                title: `פנייה #${ticket.ticket_number}`,
                description: ticket.subject,
                icon: FileText, color: 'text-blue-600 bg-blue-50'
            });
        });

        (repairs || []).forEach(repair => {
            events.push({
                type: 'repair', date: repair.created_date,
                title: `תיקון #${repair.repair_id}`,
                description: `${repair.issue_category} - ${repair.status}`,
                icon: Wrench, color: 'text-orange-600 bg-orange-50'
            });
        });

        (activities || []).forEach(activity => {
            const isWhatsapp = activity.activity_type?.includes('וואטסאפ');
            events.push({
                type: 'activity', date: activity.created_date,
                title: activity.activity_type,
                description: activity.content?.substring(0, 100) || activity.summary,
                icon: MessageCircle,
                color: isWhatsapp ? 'text-green-600 bg-green-50' : 'text-purple-600 bg-purple-50'
            });
        });

        (smsLogs || []).forEach(sms => {
            events.push({
                type: 'sms', date: sms.sent_at || sms.created_date,
                title: `SMS ${sms.event_type || ''}`,
                description: sms.message?.substring(0, 100),
                icon: Send, color: 'text-teal-600 bg-teal-50'
            });
        });

        // Group invoices by doc_number
        const invoiceGroups = {};
        (invoices || []).forEach(inv => {
            const key = inv.doc_number;
            if (!invoiceGroups[key]) {
                invoiceGroups[key] = { ...inv, total: 0, count: 0 };
            }
            invoiceGroups[key].total += inv.total_row_amount || 0;
            invoiceGroups[key].count++;
        });
        Object.values(invoiceGroups).forEach(inv => {
            events.push({
                type: 'invoice', date: inv.issue_date,
                title: `חשבונית #${inv.doc_number}`,
                description: `${inv.doc_type} • ₪${Math.round(inv.total).toLocaleString()} • ${inv.count} פריטים`,
                icon: FileText, color: 'text-indigo-600 bg-indigo-50'
            });
        });

        // Shipments
        (shipments || []).forEach(s => {
            const info = shipmentTypeInfo(s.shipment_type);
            events.push({
                type: 'shipment', date: s.created_date,
                title: `${info.title} ${s.tracking_number || '#' + (s.id?.slice(-6) || '')}`,
                description: `${s.carrier || ''} → ${s.consignee_city || ''} • ${s.cargo_status_text || s.status || ''}`,
                icon: info.icon, color: info.color
            });
        });

        // SuperPharm orders
        (spOrders || []).forEach(sp => {
            events.push({
                type: 'sp-order', date: sp.created_at_mirakl,
                title: `סופר-פארם #${sp.mirakl_order_id}`,
                description: `₪${sp.total_price || 0} • ${sp.order_state || ''}`,
                icon: Package, color: 'text-emerald-600 bg-emerald-50'
            });
            if (sp.tracking_number) {
                events.push({
                    type: 'sp-tracking', date: sp.shipped_at || sp.updated_date,
                    title: `משלוח סופר-פארם #${sp.mirakl_order_id}`,
                    description: `${sp.carrier_name || sp.carrier_code || ''} • מעקב ${sp.tracking_number}`,
                    icon: Truck, color: 'text-cyan-600 bg-cyan-50'
                });
            }
            if (sp.linet_invoice_doc_id) {
                events.push({
                    type: 'sp-invoice', date: sp.linet_invoice_created_at || sp.updated_date,
                    title: `חשבונית סופר-פארם #${sp.mirakl_order_id}`,
                    description: `מס׳ חשבונית ${sp.linet_invoice_doc_number || sp.linet_invoice_doc_id}${sp.linet_invoice_email_sent ? ' • נשלחה במייל' : ''}`,
                    icon: FileText, color: 'text-indigo-600 bg-indigo-50'
                });
            }
        });

        events.sort((a, b) => new Date(b.date) - new Date(a.date));
        return events;
    }, [orders, tickets, repairs, activities, smsLogs, invoices, shipments, spOrders]);

    if (timeline.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין פעילות ללקוח זה</p>
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="absolute right-6 top-0 bottom-0 w-0.5 bg-gray-200"></div>
            {timeline.map((event, index) => {
                const Icon = event.icon;
                return (
                    <div key={index} className="relative pr-12 pb-8">
                        <div className={`absolute right-4 w-5 h-5 rounded-full flex items-center justify-center ${event.color}`}>
                            <Icon className="w-3 h-3" />
                        </div>
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-semibold">{event.title}</p>
                                        <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                                    </div>
                                    <span className="text-xs text-gray-500">{formatDate(event.date)}</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                );
            })}
        </div>
    );
}