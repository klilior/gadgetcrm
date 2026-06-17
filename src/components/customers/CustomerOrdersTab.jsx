import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, ExternalLink, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
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
    'failed': 'נכשל',
    'wc-awaiting-serial': 'ממתין למספר סידורי',
    'ordered': 'הוזמנה מהבשמים',
};

const STATUS_COLORS = {
    'processing': 'bg-blue-100 text-blue-800',
    'completed': 'bg-green-100 text-green-800',
    'pending': 'bg-yellow-100 text-yellow-800',
    'on-hold': 'bg-orange-100 text-orange-800',
    'cancelled': 'bg-red-100 text-red-800',
    'refunded': 'bg-purple-100 text-purple-800',
    'failed': 'bg-red-100 text-red-800',
    'wc-awaiting-serial': 'bg-amber-100 text-amber-800',
    'ordered': 'bg-purple-100 text-purple-800',
};

const SHIPPING_KEYWORDS = ['משלוח', 'דואר', 'שליח', 'shipping', 'delivery', 'הובלה', 'שילוח'];

function isShippingItem(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return SHIPPING_KEYWORDS.some(kw => lower.includes(kw));
}

function formatDate(dateString) {
    if (!dateString) return 'אין מידע';
    try { return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: he }); }
    catch { return 'תאריך לא תקין'; }
}

export default function CustomerOrdersTab({ orders, customerName }) {
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
    const [orderProducts, setOrderProducts] = useState({});
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [expandedOrder, setExpandedOrder] = useState(null);

    // Load all order products eagerly
    useEffect(() => {
        if (!orders || orders.length === 0) { setLoadingProducts(false); return; }
        loadAllProducts();
    }, [orders]);

    const loadAllProducts = async () => {
        setLoadingProducts(true);
        const productsMap = {};
        for (const order of orders) {
            const products = await base44.entities.OrderProduct.filter({ order_id: order.id }).catch(() => []);
            productsMap[order.id] = products.filter(p => !isShippingItem(p.name));
        }
        setOrderProducts(productsMap);
        setLoadingProducts(false);
    };

    const handleOrderClick = async (order, e) => {
        e.stopPropagation();
        let billingData = {};
        if (order.raw_data_billing) {
            try { billingData = JSON.parse(order.raw_data_billing); } catch { }
        }
        const lineItems = orderProducts[order.id] || [];
        setSelectedOrder({
            ...order,
            billing: billingData,
            line_items: lineItems,
            client_name: customerName || 'לא ידוע'
        });
        setIsOrderModalOpen(true);
    };

    const toggleExpand = (orderId) => {
        setExpandedOrder(expandedOrder === orderId ? null : orderId);
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
            <div className="space-y-3">
                {orders.map(order => {
                    const products = orderProducts[order.id] || [];
                    const isExpanded = expandedOrder === order.id;
                    return (
                        <Card key={order.id} className="hover:shadow-lg transition-shadow">
                            <CardContent className="p-4">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => handleOrderClick(order, e)}
                                                className="font-semibold text-lg text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                                            >
                                                הזמנה #{order.external_order_number}
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1">{formatDate(order.order_date)}</p>
                                        {order.shipping_method && (
                                            <p className="text-xs text-gray-400 mt-0.5">משלוח: {order.shipping_method}</p>
                                        )}

                                        {/* Inline product preview */}
                                        {!loadingProducts && products.length > 0 && (
                                            <div className="mt-2">
                                                <button
                                                    onClick={() => toggleExpand(order.id)}
                                                    className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
                                                >
                                                    {products.length} פריטים
                                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                                </button>
                                                {isExpanded && (
                                                    <div className="mt-2 space-y-1 bg-gray-50 rounded-lg p-2">
                                                        {products.map((p, i) => (
                                                            <div key={i} className="flex justify-between text-xs">
                                                                <span className="text-gray-700 truncate flex-1">{p.name}</span>
                                                                <div className="flex items-center gap-2 flex-shrink-0 mr-2">
                                                                    <span className="text-gray-500">×{p.quantity}</span>
                                                                    <span className="font-medium">₪{parseFloat(p.total || 0).toFixed(0)}</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {loadingProducts && (
                                            <Loader2 className="w-3 h-3 animate-spin text-gray-400 mt-2" />
                                        )}
                                    </div>
                                    <div className="text-left flex-shrink-0">
                                        <p className="text-2xl font-bold text-green-600">₪{order.total}</p>
                                        <Badge variant="outline" className={`mt-1 ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-800'}`}>
                                            {STATUS_MAPPING[order.status] || order.status}
                                        </Badge>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
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