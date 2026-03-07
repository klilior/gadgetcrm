import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import OrderDetailsModal from '../orders/OrderDetailsModal';

const STATUS_MAPPING = {
    'processing': 'בטיפול',
    'completed': 'הושלם',
    'pending': 'ממתין לתשלום',
    'on-hold': 'בהמתנה',
    'cancelled': 'בוטל',
    'refunded': 'הוחזר',
    'failed': 'נכשל'
};

const STATUS_COLORS = {
    'processing': 'bg-blue-100 text-blue-800',
    'completed': 'bg-green-100 text-green-800',
    'pending': 'bg-yellow-100 text-yellow-800',
    'on-hold': 'bg-orange-100 text-orange-800',
    'cancelled': 'bg-red-100 text-red-800',
    'refunded': 'bg-purple-100 text-purple-800',
    'failed': 'bg-red-100 text-red-800'
};

function formatDate(dateString) {
    if (!dateString) return 'אין מידע';
    try {
        return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: he });
    } catch {
        return 'תאריך לא תקין';
    }
}

export default function CustomerOrdersTab({ orders, customerName }) {
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);

    const handleOrderClick = async (order) => {
        let billingData = {};
        if (order.raw_data_billing) {
            try { billingData = JSON.parse(order.raw_data_billing); } catch { }
        }
        const { OrderProduct } = await import('@/entities/all');
        const lineItems = await OrderProduct.filter({ order_id: order.id }).catch(() => []);
        setSelectedOrder({
            ...order,
            billing: billingData,
            line_items: lineItems,
            client_name: customerName || 'לא ידוע'
        });
        setIsOrderModalOpen(true);
    };

    if (!orders || orders.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Package className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין הזמנות ללקוח זה</p>
            </div>
        );
    }

    return (
        <>
            <div className="space-y-4">
                {orders.map(order => (
                    <Card
                        key={order.id}
                        className="hover:shadow-lg transition-shadow cursor-pointer"
                        onClick={() => handleOrderClick(order)}
                    >
                        <CardContent className="p-4">
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <p className="font-semibold text-lg">הזמנה #{order.external_order_number}</p>
                                        <ExternalLink className="w-4 h-4 text-gray-400" />
                                    </div>
                                    <p className="text-sm text-gray-500 mt-1">{formatDate(order.order_date)}</p>
                                    {order.shipping_method && (
                                        <p className="text-xs text-gray-500 mt-1">משלוח: {order.shipping_method}</p>
                                    )}
                                </div>
                                <div className="text-left">
                                    <p className="text-2xl font-bold text-green-600">₪{order.total}</p>
                                    <Badge variant="outline" className={`mt-1 ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-800'}`}>
                                        {STATUS_MAPPING[order.status] || order.status}
                                    </Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            {selectedOrder && (
                <OrderDetailsModal
                    order={selectedOrder}
                    open={isOrderModalOpen}
                    onClose={() => { setIsOrderModalOpen(false); setSelectedOrder(null); }}
                    getStatusColor={(s) => STATUS_COLORS[s] || 'bg-gray-100 text-gray-800'}
                    STATUS_MAPPING={STATUS_MAPPING}
                />
            )}
        </>
    );
}