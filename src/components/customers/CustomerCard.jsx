import React, { useState, useEffect, useCallback } from 'react';
import { customersService } from '../utils/customersService';
import { loadAllCustomerData } from './CustomerDataLoader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    X, User, Phone, Mail, MapPin, Calendar, DollarSign,
    TrendingUp, Package, Wrench, MessageCircle, FileText,
    Edit, Phone as PhoneIcon, Send, PlusCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import SendSmsModal from '../sms/SendSmsModal';
import CustomerDevicesList from './CustomerDevicesList';
import CustomerScoreBadge from './CustomerScoreBadge';
import CustomerAISummary from './CustomerAISummary';
import CustomerCallsTab from './CustomerCallsTab';
import CustomerInvoicesTab from './CustomerInvoicesTab';
import CustomerRepairsTab from './CustomerRepairsTab';
import CustomerTicketsTab from './CustomerTicketsTab';
import CustomerOrdersTab from './CustomerOrdersTab';
import CustomerPurchasesTab from './CustomerPurchasesTab';
import CustomerRecordingsTab from './CustomerRecordingsTab';
import CustomerTimelineTab from './CustomerTimelineTab';
import CustomerSmsTab from './CustomerSmsTab';

export default function CustomerCard({ customerId, isOpen, onClose, onEdit }) {
    const [customer, setCustomer] = useState(null);
    const [stats, setStats] = useState({ totalOrders: 0, totalSpent: 0, totalTickets: 0, totalRepairs: 0, lastOrderDate: null, lastContactDate: null, smsCount: 0 });
    const [orders, setOrders] = useState([]);
    const [tickets, setTickets] = useState([]);
    const [repairs, setRepairs] = useState([]);
    const [activities, setActivities] = useState([]);
    const [devices, setDevices] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [smsLogs, setSmsLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showSmsModal, setShowSmsModal] = useState(false);
    const navigate = useNavigate();

    const handleCreateTicket = () => {
        const url = createPageUrl('MessageCenter') + `?createTicketFor=${customerId}`;
        navigate(url);
    };

    const loadCustomerData = useCallback(async () => {
        if (!customerId) return;
        setIsLoading(true);
        setLoadError(null);

        try {
            const customerData = await customersService.get(customerId);
            setCustomer(customerData);

            const data = await loadAllCustomerData(customerId, customerData);
            if (!data) {
                setLoadError('לא ניתן לטעון נתוני לקוח');
                return;
            }

            setOrders(data.orders);
            setTickets(data.tickets);
            setRepairs(data.repairs);
            setActivities(data.activities);
            setDevices(data.devices);
            setInvoices(data.invoices);
            setSmsLogs(data.smsLogs);
            setStats(data.stats);
        } catch (error) {
            console.error('[CustomerCard] Critical error:', error);
            setLoadError('שגיאה בטעינת נתוני לקוח: ' + (error?.message || ''));
        } finally {
            setIsLoading(false);
        }
    }, [customerId]);

    useEffect(() => {
        if (isOpen && customerId) {
            loadCustomerData();
        }
    }, [isOpen, customerId, loadCustomerData]);

    const formatDate = (dateString) => {
        if (!dateString) return 'אין מידע';
        try { return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: he }); }
        catch { return 'תאריך לא תקין'; }
    };

    if (!isOpen) return null;

    const callCount = activities.filter(a => a.activity_type === 'שיחה נכנסת' || a.activity_type === 'שיחה יוצאת').length;

    return (
        <>
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl">
                <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-6xl h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-gradient-to-l from-purple-600 to-blue-600 p-4 sm:p-6 text-white flex-shrink-0">
                        <div className="flex justify-between items-start gap-2">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-12 h-12 sm:w-20 sm:h-20 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                                    <User className="w-6 h-6 sm:w-10 sm:h-10" />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-xl sm:text-3xl font-bold mb-1 truncate">{customer?.full_name || 'טוען...'}</h2>
                                    <div className="flex gap-1.5 items-center flex-wrap">
                                        <CustomerScoreBadge 
                                            score={customer?.customer_score || 0} 
                                            tier={customer?.customer_tier || 'חדש'} 
                                            size="sm" 
                                        />
                                        <Badge variant="outline" className="bg-white/20 border-white/40 text-white text-[10px] sm:text-xs">
                                            מ-{customer?.created_date ? format(new Date(customer.created_date), 'MM/yyyy', { locale: he }) : '...'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <Button variant="ghost" size="sm" onClick={handleCreateTicket} className="text-white hover:bg-white/20 gap-2 hidden sm:flex">
                                    <PlusCircle className="w-4 h-4" />
                                    צור טיקט
                                </Button>
                                <Button variant="ghost" size="icon" onClick={handleCreateTicket} className="text-white hover:bg-white/20 sm:hidden h-8 w-8">
                                    <PlusCircle className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => onEdit(customer)} className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10">
                                    <Edit className="w-4 h-4 sm:w-5 sm:h-5" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10">
                                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Quick Stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mt-4 sm:mt-6">
                            <div className="bg-white/10 backdrop-blur rounded-lg p-2.5 sm:p-4">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <DollarSign className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                                    <span className="text-[10px] sm:text-sm opacity-90">סה"כ רכישות</span>
                                </div>
                                <p className="text-lg sm:text-2xl font-bold">₪{stats.totalSpent.toLocaleString()}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur rounded-lg p-2.5 sm:p-4">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <Package className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                                    <span className="text-[10px] sm:text-sm opacity-90">הזמנות</span>
                                </div>
                                <p className="text-lg sm:text-2xl font-bold">{stats.totalOrders}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur rounded-lg p-2.5 sm:p-4">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <Wrench className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                                    <span className="text-[10px] sm:text-sm opacity-90">תיקונים</span>
                                </div>
                                <p className="text-lg sm:text-2xl font-bold">{stats.totalRepairs}</p>
                            </div>
                            <div className="bg-white/10 backdrop-blur rounded-lg p-2.5 sm:p-4">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <MessageCircle className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                                    <span className="text-[10px] sm:text-sm opacity-90">פניות / שיחות</span>
                                </div>
                                <p className="text-lg sm:text-2xl font-bold">{stats.totalTickets} / {callCount}</p>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-3 sm:p-6">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="text-center">
                                    <div className="animate-spin w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                                    <p className="text-gray-600">טוען מידע...</p>
                                </div>
                            </div>
                        ) : loadError ? (
                            <div className="text-center py-20 text-red-600">
                                <p className="text-lg font-semibold">שגיאה</p>
                                <p className="text-sm mt-2">{loadError}</p>
                                <Button onClick={loadCustomerData} className="mt-4">נסה שוב</Button>
                            </div>
                        ) : (
                            <Tabs defaultValue="overview" className="w-full">
                                <TabsList className="flex w-full overflow-x-auto mb-4 sm:mb-6 gap-0">
                                    <TabsTrigger value="overview" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">סקירה</TabsTrigger>
                                    <TabsTrigger value="devices" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">מכשירים ({devices.length})</TabsTrigger>
                                    <TabsTrigger value="purchases" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">🛒 רכישות</TabsTrigger>
                                    <TabsTrigger value="orders" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">הזמנות ({stats.totalOrders})</TabsTrigger>
                                    <TabsTrigger value="invoices" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">חשבוניות ({invoices.length})</TabsTrigger>
                                    <TabsTrigger value="calls" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">שיחות ({callCount})</TabsTrigger>
                                    <TabsTrigger value="tickets" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">פניות ({stats.totalTickets})</TabsTrigger>
                                    <TabsTrigger value="repairs" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">תיקונים ({stats.totalRepairs})</TabsTrigger>
                                    <TabsTrigger value="sms" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">SMS ({smsLogs.length})</TabsTrigger>
                                    <TabsTrigger value="recordings" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">הקלטות</TabsTrigger>
                                    <TabsTrigger value="timeline" className="text-xs sm:text-sm whitespace-nowrap px-2 sm:px-3">ציר זמן</TabsTrigger>
                                </TabsList>

                                {/* Overview Tab */}
                                <TabsContent value="overview" className="space-y-4 sm:space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
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
                                                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                                        <Phone className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs sm:text-sm text-gray-500">טלפון</p>
                                                            <a href={`tel:${customer.phone}`} className="text-sm sm:text-lg font-semibold text-blue-600 hover:underline break-all">
                                                                {customer.phone}
                                                            </a>
                                                        </div>
                                                        <div className="flex gap-1">
                                                            <Button size="sm" variant="outline" onClick={() => setShowSmsModal(true)} className="gap-1 text-teal-700 border-teal-300 hover:bg-teal-50 h-8 text-xs">
                                                                <MessageCircle className="w-3.5 h-3.5" />
                                                                <span className="hidden sm:inline">SMS</span>
                                                            </Button>
                                                            <Button size="sm" variant="outline" asChild className="h-8">
                                                                <a href={`tel:${customer.phone}`}><PhoneIcon className="w-3.5 h-3.5" /></a>
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                                {customer?.email && (
                                                    <div className="flex items-center gap-2 sm:gap-3">
                                                        <Mail className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs sm:text-sm text-gray-500">אימייל</p>
                                                            <a href={`mailto:${customer.email}`} className="text-sm sm:text-lg font-semibold text-blue-600 hover:underline break-all">
                                                                {customer.email}
                                                            </a>
                                                        </div>
                                                        <Button size="sm" variant="outline" className="h-8">
                                                            <Send className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </div>
                                                )}
                                                {customer?.city && (
                                                    <div className="flex items-center gap-3">
                                                        <MapPin className="w-5 h-5 text-red-600" />
                                                        <div>
                                                            <p className="text-sm text-gray-500">כתובת</p>
                                                            <p className="text-lg font-semibold">{customer.full_address || customer.city}</p>
                                                        </div>
                                                    </div>
                                                )}
                                                {customer?.preferred_channel && (
                                                    <div className="flex items-center gap-3">
                                                        <MessageCircle className="w-5 h-5 text-blue-600" />
                                                        <div>
                                                            <p className="text-sm text-gray-500">ערוץ מועדף</p>
                                                            <p className="text-lg font-semibold capitalize">{customer.preferred_channel}</p>
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
                                                <div className="flex justify-between items-center p-3 bg-teal-50 rounded-lg">
                                                    <span className="text-sm text-gray-700">שיחות</span>
                                                    <span className="font-semibold text-gray-900">{callCount}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 bg-indigo-50 rounded-lg">
                                                    <span className="text-sm text-gray-700">הודעות SMS</span>
                                                    <span className="font-semibold text-gray-900">{stats.smsCount}</span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    <CustomerAISummary 
                                        customer={customer} 
                                        orders={orders} 
                                        repairs={repairs} 
                                        tickets={tickets} 
                                        devices={devices} 
                                    />

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

                                <TabsContent value="devices">
                                    <CustomerDevicesList customerId={customerId} />
                                </TabsContent>

                                <TabsContent value="orders">
                                    <CustomerOrdersTab orders={orders} customerName={customer?.full_name} />
                                </TabsContent>

                                <TabsContent value="invoices">
                                    <CustomerInvoicesTab invoices={invoices} />
                                </TabsContent>

                                <TabsContent value="calls">
                                    <CustomerCallsTab activities={activities} />
                                </TabsContent>

                                <TabsContent value="tickets">
                                    <CustomerTicketsTab tickets={tickets} />
                                </TabsContent>

                                <TabsContent value="repairs">
                                    <CustomerRepairsTab repairs={repairs} />
                                </TabsContent>

                                <TabsContent value="sms">
                                    <CustomerSmsTab smsLogs={smsLogs} />
                                </TabsContent>

                                <TabsContent value="recordings">
                                    <CustomerRecordingsTab activities={activities} />
                                </TabsContent>

                                <TabsContent value="timeline">
                                    <CustomerTimelineTab 
                                        orders={orders} 
                                        tickets={tickets} 
                                        repairs={repairs} 
                                        activities={activities} 
                                        smsLogs={smsLogs} 
                                        invoices={invoices} 
                                    />
                                </TabsContent>
                            </Tabs>
                        )}
                    </div>
                </div>
            </div>

            <SendSmsModal
                isOpen={showSmsModal}
                onClose={() => setShowSmsModal(false)}
                phone={customer?.phone}
                customerName={customer?.full_name}
            />
        </>
    );
}