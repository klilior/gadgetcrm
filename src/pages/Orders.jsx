import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, Search, RefreshCw, Loader2, ListFilter, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import OrderDetailsModal from '../components/orders/OrderDetailsModal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CustomerCard from '../components/customers/CustomerCard';

const STATUS_MAPPING = {
    'processing': 'בטיפול', 'on-hold': 'מושהה', 'pending': 'ממתינה לתשלום',
    'completed': 'הושלמה', 'cancelled': 'בוטלה', 'refunded': 'הוחזרה',
    'failed': 'נכשלה', 'draft': 'טיוטה', 'wc-awaiting-serial': 'ממתין למספר סידורי'
};

const getStatusColor = (status) => {
    switch (status) {
        case "processing": return "bg-green-100 text-green-800 border-green-200";
        case "on-hold": return "bg-orange-100 text-orange-800 border-orange-200";
        case "completed": return "bg-blue-100 text-blue-800 border-blue-200";
        case "pending": return "bg-yellow-100 text-yellow-800 border-yellow-200";
        case "cancelled": return "bg-red-100 text-red-800 border-red-200";
        case "refunded": return "bg-pink-100 text-pink-800 border-pink-200";
        case "failed": return "bg-red-200 text-red-900 border-red-300";
        case "wc-awaiting-serial": return "bg-violet-100 text-violet-800 border-violet-200";
        default: return "bg-gray-200 text-gray-800 border-gray-300";
    }
};

export default function OrdersPage() {
    const [orders, setOrders] = useState([]);
    const [clients, setClients] = useState({});
  const [clientsList, setClientsList] = useState([]);
    const [orderProducts, setOrderProducts] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [showCustomerCard, setShowCustomerCard] = useState(false);
    const [selectedCustomerForCard, setSelectedCustomerForCard] = useState(null);
    const [syncError, setSyncError] = useState(null);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        setLoadError(null);
        const start = Date.now();
        try {
            // Limit to 200 recent orders (was 10,000)
            const [fetchedOrders, fetchedClients] = await Promise.all([
              base44.entities.Order.list("-order_date", 200),
              (await import('../components/utils/customersService')).customersService.list()
            ]);
            console.log(`⏱️ [Orders] Loaded ${(fetchedOrders || []).length} orders in ${Date.now() - start}ms`);
            
            setOrders(fetchedOrders || []);
            setClientsList(fetchedClients || []);
            setClients((fetchedClients || []).reduce((acc, c) => ({ ...acc, [c.id]: c }), {}));
            
            try {
                const fetchedProducts = await base44.entities.OrderProduct.list();
                const productsByOrder = (fetchedProducts || []).reduce((acc, p) => {
                    if (!acc[p.order_id]) acc[p.order_id] = [];
                    acc[p.order_id].push(p);
                    return acc;
                }, {});
                setOrderProducts(productsByOrder);
            } catch (e) {
                console.log("Could not load OrderProduct:", e.message);
                setOrderProducts({});
            }
            
        } catch (error) {
            console.error("Error loading data:", error);
            setLoadError(error.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSync = async () => {
        setIsSyncing(true);
        setSyncError(null);
        try {
            const { data } = await base44.functions.invoke('syncWooCommerceOrders');
            if (!data.success) throw new Error(data.error);
            
            alert(`✅ ${data.message}`);
            await loadData();
        } catch (error) {
            console.error('Sync error:', error);
            setSyncError(error.message);
            alert(`❌ שגיאה: ${error.message}`);
        } finally {
            setIsSyncing(false);
        }
    };

    // _legacy: Auto-sync on mount removed — sync is handled by scheduled backend function
    // Manual sync still available via the "סנכרון עכשיו" button

    const sortedAndFilteredOrders = useMemo(() => {
        return (orders || []).filter(order => {
            if (!order) return false;
            
            const client = clients[order.client_id];
            const products = orderProducts[order.id] || [];
            
            const statusMatch = statusFilter === 'all' || order.status === statusFilter;
            const search = searchTerm.toLowerCase();
            if (!search) return statusMatch;

            const searchMatch = (
                order.external_order_number?.toLowerCase().includes(search) ||
                client?.full_name?.toLowerCase().includes(search) ||
                client?.phone?.includes(search) ||
                client?.email?.toLowerCase().includes(search) ||
                products.some(product => product.name?.toLowerCase().includes(search)) ||
                order.shipping_method?.toLowerCase().includes(search) ||
                order.customer_note?.toLowerCase().includes(search)
            );
            
            return statusMatch && searchMatch;
        });
    }, [orders, clients, orderProducts, searchTerm, statusFilter]);

    const handleSelectOrder = (order) => {
        const client = clients[order.client_id];
        const products = orderProducts[order.id] || [];
        let billing = {};
        try {
            billing = JSON.parse(order.raw_data_billing || '{}');
        } catch (e) {
            console.warn("Failed to parse billing data for order:", order.id, e);
        }

        setSelectedOrder({
            ...order,
            billing,
            shipping_lines: [{ method_title: order.shipping_method }],
            line_items: products,
            client_name: client?.full_name
        });
    }

    const handleStatusChange = (orderId, newStatus) => {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        // Re-open with updated status
        setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
    };

    // פונקציה לבדיקה אם משלוח דחוף
    const isUrgentShipping = (order) => {
        const shippingMethod = order.shipping_method?.toLowerCase() || '';
        return (
            (shippingMethod.includes('משלוח היום') || 
             shippingMethod.includes('היום') ||
             shippingMethod.includes('דחוף')) && 
            order.status === 'processing'
        );
    };

    if (loadError) {
        return (
            <div className="p-6 space-y-6">
                <h1 className="text-3xl font-bold text-gray-900">ניהול הזמנות</h1>
                <Card className="glass-card border-0">
                    <CardContent className="p-6">
                        <div className="text-center py-10">
                            <AlertTriangle className="w-16 h-16 mx-auto mb-4 text-red-500" />
                            <h3 className="text-xl font-semibold text-red-700 mb-2">שגיאה בטעינת הנתונים</h3>
                            <p className="text-gray-600 mb-4">{loadError}</p>
                            <Button onClick={loadData}>נסה שוב</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">ניהול הזמנות</h1>
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="סנן לפי סטטוס" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">כל הסטטוסים</SelectItem>
                            {Object.entries(STATUS_MAPPING).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="relative flex-grow sm:flex-grow-0 w-full sm:w-auto">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <Input 
                            placeholder="חיפוש לפי מס׳ הזמנה, לקוח, מוצר..." 
                            value={searchTerm} 
                            onChange={e => setSearchTerm(e.target.value)} 
                            className="pr-10 w-full sm:w-80" 
                        />
                    </div>
                    <Button 
                        onClick={handleSync} 
                        disabled={isSyncing} 
                        className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto"
                    >
                        {isSyncing ? (
                            <Loader2 className="w-4 h-4 animate-spin ml-2" />
                        ) : (
                            <RefreshCw className="w-4 h-4 ml-2" />
                        )}
                        <span>{isSyncing ? "מסנכרן..." : "סנכרון עכשיו"}</span>
                    </Button>
                </div>
            </div>
            
            <Card className="glass-card border-0 bg-blue-50/50">
                <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                        <RefreshCw className="w-5 h-5 text-blue-600" />
                        <div>
                            <p className="font-semibold text-blue-900">סנכרון אוטומטי פעיל</p>
                            <p className="text-sm text-blue-700">ההזמנות מתעדכנות אוטומטית כל 30 דקות מוווקומרס</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            {syncError && (
                <Card className="glass-card border-0 bg-red-50/50">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                            <div>
                                <p className="font-semibold text-red-900">שגיאה בסנכרון</p>
                                <p className="text-sm text-red-700">{syncError}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
            
            <Card className="glass-card border-0">
                <CardHeader>
                    <CardTitle>הזמנות ({sortedAndFilteredOrders.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-10">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600" />
                        </div>
                    ) : sortedAndFilteredOrders.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">
                            <Package className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                            <p>לא נמצאו הזמנות</p>
                            <p className="text-sm mt-2">לחץ על "סנכרון עכשיו" לייבוא הזמנות מ-WooCommerce</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>מס' הזמנה</TableHead>
                                        <TableHead>שם לקוח</TableHead>
                                        <TableHead>תאריך</TableHead>
                                        <TableHead>סטטוס</TableHead>
                                        <TableHead>שיטת משלוח</TableHead>
                                        <TableHead>הערות</TableHead>
                                        <TableHead className="text-left">סה"כ</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedAndFilteredOrders.map((order) => {
                                        const client = clients[order.client_id];
                                        const isUrgent = isUrgentShipping(order);
                                        
                                        return (
                                            <TableRow 
                                                key={order.id} 
                                                className={`cursor-pointer hover:bg-gray-50/80 ${
                                                    isUrgent ? 'bg-red-50 animate-pulse hover:bg-red-100' : ''
                                                }`}
                                                onClick={() => handleSelectOrder(order)}
                                            >
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        #{order.external_order_number}
                                                        {isUrgent && (
                                                            <Badge className="bg-red-600 text-white animate-bounce">
                                                                🚨 דחוף!
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell 
                                                    className="text-blue-600 hover:underline cursor-pointer"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedCustomerForCard(order.client_id);
                                                        setShowCustomerCard(true);
                                                    }}
                                                >
                                                    {client?.full_name || 'מידע חסר'}
                                                </TableCell>
                                                <TableCell>
                                                    {order.order_date ? format(new Date(order.order_date), "dd/MM/yy HH:mm") : '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={`border ${getStatusColor(order.status)}`}>
                                                        {STATUS_MAPPING[order.status] || order.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className={`text-sm ${isUrgent ? 'text-red-700 font-bold text-base' : 'text-gray-600'}`}>
                                                        {order.shipping_method || '-'}
                                                        {isUrgent && ' 🔥'}
                                                        {order.pickup_point_data && (
                                                            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] mr-1">📍 נק׳ איסוף</Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="max-w-[200px]">
                                                    {order.customer_note ? (
                                                        <div className="text-sm text-gray-600 truncate" title={order.customer_note}>
                                                            {order.customer_note}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 text-sm">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-left font-mono">
                                                    ₪{parseFloat(order.total || 0).toFixed(2)}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
            
            {selectedOrder && (
                <OrderDetailsModal
                    open={!!selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    order={selectedOrder}
                    STATUS_MAPPING={STATUS_MAPPING}
                    getStatusColor={getStatusColor}
                    onStatusChange={handleStatusChange}
                />
            )}

            <CustomerCard
                customerId={selectedCustomerForCard}
                isOpen={showCustomerCard}
                onClose={() => {
                    setShowCustomerCard(false);
                    setSelectedCustomerForCard(null);
                }}
                onEdit={() => {}}
            />
        </div>
    );
}