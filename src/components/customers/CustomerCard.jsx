import React, { useState, useEffect, useCallback } from 'react';
import { Ticket, Order, Repair, Activity } from '@/entities/all';
import { customersService } from '../utils/customersService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    X, User, Phone, Mail, MapPin, Calendar, DollarSign,
    TrendingUp, Package, Wrench, MessageCircle, FileText,
    Star, Edit, ShoppingCart, Phone as PhoneIcon, Send, ExternalLink, PlusCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import OrderDetailsModal from '../orders/OrderDetailsModal';

export default function CustomerCard({ customerId, isOpen, onClose, onEdit }) {
    const [customer, setCustomer] = useState(null);
    const [stats, setStats] = useState({
        totalOrders: 0,
        totalSpent: 0,
        totalTickets: 0,
        totalRepairs: 0,
        lastOrderDate: null,
        lastContactDate: null
    });
    const [orders, setOrders] = useState([]);
    const [tickets, setTickets] = useState([]);
    const [repairs, setRepairs] = useState([]);
    const [activities, setActivities] = useState([]);
    const [timeline, setTimeline] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
    const navigate = useNavigate();

    const handleCreateTicket = () => {
        // Navigate to MessageCenter with createTicketFor param
        // Using createPageUrl to ensure correct path, adding query param
        const url = createPageUrl('MessageCenter') + `?createTicketFor=${customerId}`;
        navigate(url);
    };

    const buildTimeline = useCallback((ordersData, ticketsData, repairsData, activitiesData) => {
        const events = [];

        ordersData.forEach(order => {
            events.push({
                type: 'order',
                date: order.order_date,
                title: `הזמנה #${order.external_order_number}`,
                description: `סכום: ₪${order.total}`,
                icon: ShoppingCart,
                color: 'text-green-600 bg-green-50'
            });
        });

        ticketsData.forEach(ticket => {
            events.push({
                type: 'ticket',
                date: ticket.created_date,
                title: `פנייה #${ticket.ticket_number}`,
                description: ticket.subject,
                icon: FileText,
                color: 'text-blue-600 bg-blue-50'
            });
        });

        repairsData.forEach(repair => {
            events.push({
                type: 'repair',
                date: repair.created_date,
                title: `תיקון #${repair.repair_id}`,
                description: `${repair.issue_category} - ${repair.status}`,
                icon: Wrench,
                color: 'text-orange-600 bg-orange-50'
            });
        });

        activitiesData.forEach(activity => {
            const isWhatsapp = activity.activity_type?.includes('וואטסאפ');
            const isIncoming = activity.activity_type?.includes('נכנס');
            const isOutgoing = activity.activity_type?.includes('יוצא');
            
            events.push({
                type: 'activity',
                date: activity.created_date,
                title: activity.activity_type,
                description: activity.content?.substring(0, 100) || activity.summary,
                icon: MessageCircle,
                color: isWhatsapp ? (isIncoming ? 'text-green-600 bg-green-50' : 'text-blue-600 bg-blue-50') : 'text-purple-600 bg-purple-50'
            });
        });

        events.sort((a, b) => new Date(b.date) - new Date(a.date));
        setTimeline(events);
    }, []);

    const loadCustomerData = useCallback(async () => {
        if (!customerId) return;

        setIsLoading(true);
        try {
            const customerData = await customersService.get(customerId);
            setCustomer(customerData);

            const [ordersData, ticketsData, repairsData, activitiesData] = await Promise.all([
                Order.filter({ client_id: customerId }, '-order_date'),
                Ticket.filter({ customer_id: customerId }, '-created_date'),
                Repair.filter({ client_id: customerId }, '-created_date'),
                Activity.filter({ 
                    $or: [
                        { order_id: customerId },
                        { ticket_id: { $in: (await Ticket.filter({ customer_id: customerId })).map(t => t.id) } }
                    ]
                }, '-created_date')
            ]);

            setOrders(ordersData);
            setTickets(ticketsData);
            setRepairs(repairsData);
            setActivities(activitiesData);

            const totalSpent = ordersData.reduce((sum, order) => sum + parseFloat(order.total || 0), 0);
            const lastOrder = ordersData.length > 0 ? ordersData[0].order_date : null;
            const lastContact = ticketsData.length > 0 ? ticketsData[0].created_date : null;

            setStats({
                totalOrders: ordersData.length,
                totalSpent: totalSpent,
                totalTickets: ticketsData.length,
                totalRepairs: repairsData.length,
                lastOrderDate: lastOrder,
                lastContactDate: lastContact
            });

            buildTimeline(ordersData, ticketsData, repairsData, activitiesData);

        } catch (error) {
            console.error('Error loading customer data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [customerId, buildTimeline]);

    useEffect(() => {
        if (isOpen && customerId) {
            loadCustomerData();
        }
    }, [isOpen, customerId, loadCustomerData]);

    const getCustomerLevel = () => {
        if (stats.totalSpent > 5000) return { label: 'VIP', color: 'bg-purple-500 text-white' };
        if (stats.totalSpent > 2000) return { label: 'זהב', color: 'bg-yellow-500 text-white' };
        if (stats.totalSpent > 500) return { label: 'כסף', color: 'bg-gray-400 text-white' };
        return { label: 'רגיל', color: 'bg-blue-500 text-white' };
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'אין מידע';
        try {
            return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: he });
        } catch {
            return 'תאריך לא תקין';
        }
    };

    const handleOrderClick = async (order) => {
        try {
            // Parse billing data if it exists
            let billingData = {};
            if (order.raw_data_billing) {
                try {
                    billingData = JSON.parse(order.raw_data_billing);
                } catch (e) {
                    console.log("Failed to parse billing data");
                }
            }

            // Fetch line items for this order
            const { OrderProduct } = await import('@/entities/all');
            const lineItems = await OrderProduct.filter({ order_id: order.id });

            const enrichedOrder = {
                ...order,
                billing: billingData,
                line_items: lineItems,
                client_name: customer?.full_name || 'לא ידוע'
            };

            setSelectedOrder(enrichedOrder);
            setIsOrderModalOpen(true);
        } catch (error) {
            console.error("Error loading order details:", error);
        }
    };

    const getStatusColor = (status) => {
        const statusColors = {
            'processing': 'bg-blue-100 text-blue-800',
            'completed': 'bg-green-100 text-green-800',
            'pending': 'bg-yellow-100 text-yellow-800',
            'on-hold': 'bg-orange-100 text-orange-800',
            'cancelled': 'bg-red-100 text-red-800',
            'refunded': 'bg-purple-100 text-purple-800',
            'failed': 'bg-red-100 text-red-800'
        };
        return statusColors[status] || 'bg-gray-100 text-gray-800';
    };

    const STATUS_MAPPING = {
        'processing': 'בטיפול',
        'completed': 'הושלם',
        'pending': 'ממתין לתשלום',
        'on-hold': 'בהמתנה',
        'cancelled': 'בוטל',
        'refunded': 'הוחזר',
        'failed': 'נכשל'
    };

    if (!isOpen) return null;

    const customerLevel = getCustomerLevel();

    return (
        <>
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" dir="rtl">
                <div className="bg-white rounded-3xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-gradient-to-l from-purple-600 to-blue-600 p-6 text-white">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-4">
                                <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                                    <User className="w-10 h-10" />
                                </div>
                                <div>
                                    <h2 className="text-3xl font-bold mb-2">{customer?.full_name || 'טוען...'}</h2>
                                    <div className="flex gap-2 items-center flex-wrap">
                                        <Badge className={customerLevel.color}>
                                            <Star className="w-3 h-3 ml-1" />
                                            {customerLevel.label}
                                        </Badge>
                                        <Badge variant="outline" className="bg-white/20 border-white/40 text-white">
                                            לקוח מ-{customer?.created_date ? format(new Date(customer.created_date), 'MM/yyyy', { locale: he }) : '...'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={handleCreateTicket} 
                                    className="text-white hover:bg-white/20 gap-2 hidden sm:flex"
                                >
                                    <PlusCircle className="w-4 h-4" />
                                    צור טיקט
                                </Button>
                                <Button variant="ghost" size="icon" onClick={handleCreateTicket} className="text-white hover:bg-white/20 sm:hidden">
                                    <PlusCircle className="w-5 h-5" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => onEdit(customer)} className="text-white hover:bg-white/20">
                                    <Edit className="w-5 h-5" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/20">
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Quick Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <DollarSign className="w-5 h-5" />
                                    <span className="text-sm opacity-90">סה"כ רכישות</span>
                                </div>
                                <p className="text-2xl font-bold">₪{stats.totalSpent.toLocaleString()}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Package className="w-5 h-5" />
                                    <span className="text-sm opacity-90">הזמנות</span>
                                </div>
                                <p className="text-2xl font-bold">{stats.totalOrders}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <MessageCircle className="w-5 h-5" />
                                    <span className="text-sm opacity-90">פניות</span>
                                </div>
                                <p className="text-2xl font-bold">{stats.totalTickets}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Wrench className="w-5 h-5" />
                                    <span className="text-sm opacity-90">תיקונים</span>
                                </div>
                                <p className="text-2xl font-bold">{stats.totalRepairs}</p>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="text-center">
                                    <div className="animate-spin w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                                    <p className="text-gray-600">טוען מידע...</p>
                                </div>
                            </div>
                        ) : (
                            <Tabs defaultValue="overview" className="w-full">
                                <TabsList className="grid w-full grid-cols-5 mb-6">
                                    <TabsTrigger value="overview">סקירה</TabsTrigger>
                                    <TabsTrigger value="orders">הזמנות ({stats.totalOrders})</TabsTrigger>
                                    <TabsTrigger value="tickets">פניות ({stats.totalTickets})</TabsTrigger>
                                    <TabsTrigger value="repairs">תיקונים ({stats.totalRepairs})</TabsTrigger>
                                    <TabsTrigger value="timeline">ציר זמן</TabsTrigger>
                                </TabsList>

                                {/* Overview Tab */}
                                <TabsContent value="overview" className="space-y-6">
                                    <div className="grid md:grid-cols-2 gap-6">
                                        {/* Contact Info */}
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="flex items-center gap-2">
                                                    <User className="w-5 h-5 text-purple-600" />
                                                    פרטי קשר
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                {customer?.phone && (
                                                    <div className="flex items-center gap-3">
                                                        <Phone className="w-5 h-5 text-green-600" />
                                                        <div className="flex-1">
                                                            <p className="text-sm text-gray-500">טלפון</p>
                                                            <a href={`tel:${customer.phone}`} className="text-lg font-semibold text-blue-600 hover:underline">
                                                                {customer.phone}
                                                            </a>
                                                        </div>
                                                        <Button size="sm" variant="outline">
                                                            <PhoneIcon className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                )}
                                                {customer?.email && (
                                                    <div className="flex items-center gap-3">
                                                        <Mail className="w-5 h-5 text-purple-600" />
                                                        <div className="flex-1">
                                                            <p className="text-sm text-gray-500">אימייל</p>
                                                            <a href={`mailto:${customer.email}`} className="text-lg font-semibold text-blue-600 hover:underline">
                                                                {customer.email}
                                                            </a>
                                                        </div>
                                                        <Button size="sm" variant="outline">
                                                            <Send className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                )}
                                                {customer?.city && (
                                                    <div className="flex items-center gap-3">
                                                        <MapPin className="w-5 h-5 text-red-600" />
                                                        <div>
                                                            <p className="text-sm text-gray-500">כתובת</p>
                                                            <p className="text-lg font-semibold">
                                                                {customer.full_address || customer.city}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                                {customer?.preferred_channel && (
                                                    <div className="flex items-center gap-3">
                                                        <MessageCircle className="w-5 h-5 text-blue-600" />
                                                        <div>
                                                            <p className="text-sm text-gray-500">ערוץ מועדף</p>
                                                            <p className="text-lg font-semibold capitalize">
                                                                {customer.preferred_channel}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>

                                        {/* Activity Summary */}
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="flex items-center gap-2">
                                                    <TrendingUp className="w-5 h-5 text-purple-600" />
                                                    סיכום פעילות
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                                                    <span className="text-sm text-gray-700">רכישה אחרונה</span>
                                                    <span className="font-semibold text-gray-900">
                                                        {stats.lastOrderDate ? format(new Date(stats.lastOrderDate), 'dd/MM/yyyy', { locale: he }) : 'אין מידע'}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                                                    <span className="text-sm text-gray-700">יצירת קשר אחרונה</span>
                                                    <span className="font-semibold text-gray-900">
                                                        {stats.lastContactDate ? format(new Date(stats.lastContactDate), 'dd/MM/yyyy', { locale: he }) : 'אין מידע'}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
                                                    <span className="text-sm text-gray-700">ממוצע לרכישה</span>
                                                    <span className="font-semibold text-gray-900">
                                                        ₪{stats.totalOrders > 0 ? (stats.totalSpent / stats.totalOrders).toFixed(2) : '0'}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                                                    <span className="text-sm text-gray-700">תיקונים פעילים</span>
                                                    <span className="font-semibold text-gray-900">
                                                        {repairs.filter(r => !['תיקון נסגר', 'לא ניתן לתיקון'].includes(r.status)).length}
                                                    </span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* Notes */}
                                    {customer?.notes && (
                                        <Card>
                                            <CardHeader>
                                                <CardTitle className="flex items-center gap-2">
                                                    <FileText className="w-5 h-5 text-purple-600" />
                                                    הערות
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <p className="text-gray-700 whitespace-pre-wrap">{customer.notes}</p>
                                            </CardContent>
                                        </Card>
                                    )}
                                </TabsContent>

                                {/* Orders Tab */}
                                <TabsContent value="orders">
                                    <div className="space-y-4">
                                        {orders.length === 0 ? (
                                            <div className="text-center py-10 text-gray-500">
                                                <Package className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                                                <p>אין הזמנות ללקוח זה</p>
                                            </div>
                                        ) : (
                                            orders.map(order => (
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
                                                                <Badge variant="outline" className={`mt-1 ${getStatusColor(order.status)}`}>
                                                                    {STATUS_MAPPING[order.status] || order.status}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ))
                                        )}
                                    </div>
                                </TabsContent>

                                {/* Tickets Tab */}
                                <TabsContent value="tickets">
                                    <div className="space-y-4">
                                        {tickets.length === 0 ? (
                                            <div className="text-center py-10 text-gray-500">
                                                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                                                <p>אין פניות ללקוח זה</p>
                                            </div>
                                        ) : (
                                            tickets.map(ticket => (
                                                <Card key={ticket.id} className="hover:shadow-lg transition-shadow">
                                                    <CardContent className="p-4">
                                                        <div className="space-y-3">
                                                            <div className="flex justify-between items-start">
                                                                <div className="flex-1">
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <p className="font-semibold text-lg">טיקט #{ticket.ticket_number}</p>
                                                                        <Badge className={
                                                                            ticket.status === 'נסגר' ? 'bg-gray-200 text-gray-700' :
                                                                                ticket.status === 'חדש' ? 'bg-teal-100 text-teal-800' :
                                                                                    'bg-blue-100 text-blue-800'
                                                                        }>
                                                                            {ticket.status}
                                                                        </Badge>
                                                                    </div>
                                                                    <p className="text-gray-900 font-medium">{ticket.subject}</p>
                                                                    {ticket.description && (
                                                                        <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">
                                                                            {ticket.description.length > 200
                                                                                ? ticket.description.substring(0, 200) + '...'
                                                                                : ticket.description
                                                                            }
                                                                        </p>
                                                                    )}
                                                                    <div className="flex gap-4 mt-3 text-xs text-gray-500 flex-wrap">
                                                                        {ticket.inquiry_type && (
                                                                            <Badge variant="secondary" className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700">
                                                                                סוג פנייה: {ticket.inquiry_type}
                                                                            </Badge>
                                                                        )}
                                                                        {ticket.contact_channel && (
                                                                            <Badge variant="secondary" className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700">
                                                                                ערוץ: {ticket.contact_channel}
                                                                            </Badge>
                                                                        )}
                                                                        {ticket.priority && (
                                                                            <Badge variant="outline" className={`text-xs ${ticket.priority === 'גבוהה' ? 'bg-red-100 text-red-800' : ''}`}>
                                                                                {ticket.priority}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="text-xs text-gray-500 pt-2 border-t mt-3">
                                                                נוצר ב-{formatDate(ticket.created_date)}
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ))
                                        )}
                                    </div>
                                </TabsContent>

                                {/* Repairs Tab */}
                                <TabsContent value="repairs">
                                    <div className="space-y-4">
                                        {repairs.length === 0 ? (
                                            <div className="text-center py-10 text-gray-500">
                                                <Wrench className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                                                <p>אין תיקונים ללקוח זה</p>
                                            </div>
                                        ) : (
                                            repairs.map(repair => (
                                                <Card key={repair.id} className="hover:shadow-lg transition-shadow">
                                                    <CardContent className="p-4">
                                                        <div className="flex justify-between items-start">
                                                            <div className="flex-1">
                                                                <p className="font-semibold text-lg">תיקון #{repair.repair_id}</p>
                                                                <p className="text-gray-700 mt-1">{repair.issue_category} - {repair.issue_description}</p>
                                                                <p className="text-sm text-gray-500 mt-2">{formatDate(repair.created_date)}</p>
                                                            </div>
                                                            <div className="text-left">
                                                                <Badge variant="outline">{repair.status}</Badge>
                                                                {repair.final_price > 0 && (
                                                                    <p className="text-lg font-bold text-green-600 mt-2">₪{repair.final_price}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ))
                                        )}
                                    </div>
                                </TabsContent>

                                {/* Timeline Tab */}
                                <TabsContent value="timeline">
                                    <div className="space-y-4">
                                        {timeline.length === 0 ? (
                                            <div className="text-center py-10 text-gray-500">
                                                <Calendar className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                                                <p>אין פעילות ללקוח זה</p>
                                            </div>
                                        ) : (
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
                                        )}
                                    </div>
                                </TabsContent>
                            </Tabs>
                        )}
                    </div>
                </div>
            </div>

            {/* Order Details Modal */}
            {selectedOrder && (
                <OrderDetailsModal
                    order={selectedOrder}
                    open={isOrderModalOpen}
                    onClose={() => {
                        setIsOrderModalOpen(false);
                        setSelectedOrder(null);
                    }}
                    getStatusColor={getStatusColor}
                    STATUS_MAPPING={STATUS_MAPPING}
                />
            )}
        </>
    );
}