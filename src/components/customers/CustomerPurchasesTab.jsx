import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShoppingBag, Package, Receipt, Calendar, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

const SHIPPING_KEYWORDS = ['משלוח', 'דואר', 'שליח', 'shipping', 'delivery', 'הובלה', 'שילוח', 'courier'];

function isShippingItem(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return SHIPPING_KEYWORDS.some(kw => lower.includes(kw));
}

function formatDate(dateString) {
    if (!dateString) return '';
    try { return format(new Date(dateString), 'dd/MM/yyyy', { locale: he }); }
    catch { return ''; }
}

export default function CustomerPurchasesTab({ orders, invoices, customerId }) {
    const [orderProducts, setOrderProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadOrderProducts();
    }, [orders]);

    const loadOrderProducts = async () => {
        setLoading(true);
        const allProducts = [];
        // Load products for each order
        for (const order of (orders || [])) {
            const products = await base44.entities.OrderProduct.filter({ order_id: order.id }).catch(() => []);
            for (const p of products) {
                if (!isShippingItem(p.name)) {
                    allProducts.push({
                        source: 'woo',
                        name: p.name,
                        quantity: p.quantity,
                        total: p.total,
                        date: order.order_date,
                        orderNumber: order.external_order_number,
                        orderId: order.id,
                        sku: '',
                        meta_data: p.meta_data,
                    });
                }
            }
        }
        setOrderProducts(allProducts);
        setLoading(false);
    };

    // Collect invoice items (filtered)
    const invoiceItems = (invoices || [])
        .filter(inv => !isShippingItem(inv.product_name))
        .map(inv => ({
            source: 'linet',
            name: inv.product_name || inv.sku,
            quantity: inv.quantity,
            total: inv.total_row_amount,
            date: inv.issue_date,
            invoiceNumber: inv.doc_number,
            sku: inv.sku,
            docType: inv.doc_type,
            salesRep: inv.sales_rep,
        }));

    // Merge and sort by date desc
    const allPurchases = [...orderProducts, ...invoiceItems].sort((a, b) =>
        new Date(b.date || 0) - new Date(a.date || 0)
    );

    if (loading) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-500" />
                <p>טוען רכישות...</p>
            </div>
        );
    }

    if (allPurchases.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <ShoppingBag className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין רכישות ללקוח זה</p>
            </div>
        );
    }

    const totalAmount = allPurchases.reduce((sum, p) => sum + (parseFloat(p.total) || 0), 0);
    const totalItems = allPurchases.reduce((sum, p) => sum + (parseFloat(p.quantity) || 0), 0);

    return (
        <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
                <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700 px-3 py-1">
                    <ShoppingBag className="w-3.5 h-3.5 ml-1" />
                    {allPurchases.length} פריטים
                </Badge>
                <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700 px-3 py-1">
                    סה"כ ₪{Math.round(totalAmount).toLocaleString()}
                </Badge>
                <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-700 px-3 py-1">
                    {Math.round(totalItems)} יחידות
                </Badge>
            </div>

            <div className="space-y-2">
                {allPurchases.map((item, idx) => {
                    const isCredit = item.docType?.includes('זיכוי');
                    return (
                        <Card key={idx} className="hover:shadow-md transition-shadow">
                            <CardContent className="p-3">
                                <div className="flex justify-between items-start gap-3">
                                    <div className="flex items-start gap-3 flex-1 min-w-0">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                            item.source === 'woo' ? 'bg-blue-100' : 'bg-indigo-100'
                                        }`}>
                                            {item.source === 'woo' 
                                                ? <Package className="w-4 h-4 text-blue-600" />
                                                : <Receipt className="w-4 h-4 text-indigo-600" />
                                            }
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">{item.name}</p>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    {formatDate(item.date)}
                                                </span>
                                                {item.orderNumber && (
                                                    <Badge variant="outline" className="text-[10px] bg-blue-50 border-blue-200 text-blue-700">
                                                        הזמנה #{item.orderNumber}
                                                    </Badge>
                                                )}
                                                {item.invoiceNumber && (
                                                    <Badge variant="outline" className={`text-[10px] ${isCredit ? 'bg-red-50 border-red-200 text-red-700' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}>
                                                        חשבונית #{item.invoiceNumber}
                                                    </Badge>
                                                )}
                                                {item.sku && (
                                                    <span className="text-[10px] text-gray-400">מק"ט: {item.sku}</span>
                                                )}
                                                {item.salesRep && (
                                                    <span className="text-[10px] text-gray-400">{item.salesRep}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-left flex-shrink-0">
                                        <p className={`font-bold text-sm ${isCredit ? 'text-red-600' : 'text-green-600'}`}>
                                            ₪{parseFloat(item.total || 0).toLocaleString()}
                                        </p>
                                        {item.quantity > 1 && (
                                            <span className="text-[10px] text-gray-500">×{item.quantity}</span>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}