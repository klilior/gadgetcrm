import React, { useState, useEffect, useCallback } from 'react';
import { customersService } from '../utils/customersService';
import { loadAllCustomerData } from './CustomerDataLoader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    X, User, Phone, Mail, MapPin, DollarSign,
    TrendingUp, Package, Wrench, MessageCircle, FileText,
    Edit, Phone as PhoneIcon, Send, PlusCircle, Truck,
    ShoppingBag, Receipt, Calendar, Headphones, Clock,
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
import CustomerShippingTab from './CustomerShippingTab';
import CustomerSPOrdersTab from './CustomerSPOrdersTab';

const NAV_ITEMS = [
    { id: 'overview', label: 'סקירה', icon: User, color: 'text-purple-600' },
    { id: 'orders', label: 'הזמנות', icon: Package, color: 'text-blue-600' },
    { id: 'sp-orders', label: 'סופר-פארם', icon: ShoppingBag, color: 'text-emerald-600' },
    { id: 'shipping', label: 'משלוחים', icon: Truck, color: 'text-cyan-600' },
    { id: 'purchases', label: 'רכישות', icon: Receipt, color: 'text-indigo-600' },
    { id: 'invoices', label: 'חשבוניות', icon: FileText, color: 'text-amber-600' },
    { id: 'repairs', label: 'תיקונים', icon: Wrench, color: 'text-orange-600' },
    { id: 'tickets', label: 'פניות', icon: MessageCircle, color: 'text-teal-600' },
    { id: 'devices', label: 'מכשירים', icon: Phone, color: 'text-pink-600' },
    { id: 'calls', label: 'שיחות', icon: Headphones, color: 'text-green-600' },
    { id: 'sms', label: 'SMS', icon: Send, color: 'text-sky-600' },
    { id: 'recordings', label: 'הקלטות', icon: Clock, color: 'text-rose-600' },
    { id: 'timeline', label: 'ציר זמן', icon: Calendar, color: 'text-violet-600' },
];

export default function CustomerCard({ customerId, isOpen, onClose, onEdit }) {
    const [customer, setCustomer] = useState(null);
    const [stats, setStats] = useState({ totalOrders: 0, totalSpent: 0, totalTickets: 0, totalRepairs: 0, totalShipments: 0, spOrdersCount: 0, lastOrderDate: null, lastContactDate: null, smsCount: 0 });
    const [orders, setOrders] = useState([]);
    const [tickets, setTickets] = useState([]);
    const [repairs, setRepairs] = useState([]);
    const [activities, setActivities] = useState([]);
    const [devices, setDevices] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [smsLogs, setSmsLogs] = useState([]);
    const [shipments, setShipments] = useState([]);
    const [spOrders, setSpOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showSmsModal, setShowSmsModal] = useState(false);
    const [activeTab, setActiveTab] = useState('overview');
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
            if (!data) { setLoadError('לא ניתן לטעון נתוני לקוח'); return; }
            setOrders(data.orders);
            setTickets(data.tickets);
            setRepairs(data.repairs);
            setActivities(data.activities);
            setDevices(data.devices);
            setInvoices(data.invoices);
            setSmsLogs(data.smsLogs);
            setShipments(data.shipments || []);
            setSpOrders(data.spOrders || []);
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
            setActiveTab('overview');
            loadCustomerData();
        }
    }, [isOpen, customerId, loadCustomerData]);

    if (!isOpen) return null;

    const callCount = activities.filter(a => a.activity_type === 'שיחה נכנסת' || a.activity_type === 'שיחה יוצאת').length;

    // Badge counts for nav
    const counts = {
        orders: stats.totalOrders,
        'sp-orders': stats.spOrdersCount,
        shipping: stats.totalShipments + (orders.filter(o => o.tracking_number).length) + spOrders.length,
        purchases: 0, // computed inside tab
        invoices: invoices.length,
        repairs: stats.totalRepairs,
        tickets: stats.totalTickets,
        devices: devices.length,
        calls: callCount,
        sms: smsLogs.length,
        recordings: 0,
        timeline: 0,
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'overview': return <OverviewContent customer={customer} stats={stats} repairs={repairs} callCount={callCount} spOrders={spOrders} shipments={shipments} orders={orders} invoices={invoices} onSms={() => setShowSmsModal(true)} />;
            case 'orders': return <CustomerOrdersTab orders={orders} customerName={customer?.full_name} />;
            case 'sp-orders': return <CustomerSPOrdersTab spOrders={spOrders} />;
            case 'shipping': return <CustomerShippingTab shipments={shipments} orders={orders} spOrders={spOrders} />;
            case 'purchases': return <CustomerPurchasesTab orders={orders} invoices={invoices} customerId={customerId} />;
            case 'invoices': return <CustomerInvoicesTab invoices={invoices} />;
            case 'repairs': return <CustomerRepairsTab repairs={repairs} />;
            case 'tickets': return <CustomerTicketsTab tickets={tickets} />;
            case 'devices': return <CustomerDevicesList customerId={customerId} />;
            case 'calls': return <CustomerCallsTab activities={activities} />;
            case 'sms': return <CustomerSmsTab smsLogs={smsLogs} />;
            case 'recordings': return <CustomerRecordingsTab activities={activities} />;
            case 'timeline': return <CustomerTimelineTab orders={orders} tickets={tickets} repairs={repairs} activities={activities} smsLogs={smsLogs} invoices={invoices} shipments={shipments} spOrders={spOrders} />;
            default: return null;
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4" dir="rtl">
                <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-6xl h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-gradient-to-l from-purple-600 to-blue-600 p-4 sm:p-5 text-white flex-shrink-0">
                        <div className="flex justify-between items-start gap-2">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                                    <span className="text-lg sm:text-2xl font-bold">{customer?.full_name?.charAt(0) || '?'}</span>
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-lg sm:text-2xl font-bold truncate">{customer?.full_name || 'טוען...'}</h2>
                                    <div className="flex gap-1.5 items-center flex-wrap mt-0.5">
                                        <CustomerScoreBadge score={customer?.customer_score || 0} tier={customer?.customer_tier || 'חדש'} size="sm" />
                                        {customer?.phone && (
                                            <Badge variant="outline" className="bg-white/20 border-white/40 text-white text-[10px]">
                                                {customer.phone}
                                            </Badge>
                                        )}
                                        {customer?.city && (
                                            <Badge variant="outline" className="bg-white/20 border-white/40 text-white text-[10px]">
                                                <MapPin className="w-2.5 h-2.5 ml-0.5" />{customer.city}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <Button variant="ghost" size="icon" onClick={() => onEdit(customer)} className="text-white hover:bg-white/20 h-8 w-8">
                                    <Edit className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/20 h-8 w-8">
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                        {/* Quick Stats Row */}
                        <div className="flex gap-3 mt-3 overflow-x-auto pb-1 scrollbar-none">
                            <QuickStat icon={DollarSign} label="רכישות" value={`₪${Math.round(stats.totalSpent).toLocaleString()}`} />
                            <QuickStat icon={Package} label="הזמנות" value={stats.totalOrders + stats.spOrdersCount} />
                            <QuickStat icon={Truck} label="משלוחים" value={stats.totalShipments} />
                            <QuickStat icon={Wrench} label="תיקונים" value={stats.totalRepairs} />
                            <QuickStat icon={MessageCircle} label="פניות" value={stats.totalTickets} />
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 flex overflow-hidden">
                        {/* Desktop Sidebar Nav */}
                        <nav className="hidden sm:flex flex-col w-40 border-l bg-gray-50/80 overflow-y-auto flex-shrink-0 py-2">
                            {NAV_ITEMS.map(item => {
                                const Icon = item.icon;
                                const count = counts[item.id];
                                const isActive = activeTab === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => setActiveTab(item.id)}
                                        className={`flex items-center gap-2 px-3 py-2 mx-1 rounded-lg text-xs transition-all text-right ${
                                            isActive ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-600 hover:bg-white/60'
                                        }`}
                                    >
                                        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? item.color : 'text-gray-400'}`} />
                                        <span className="flex-1 truncate">{item.label}</span>
                                        {count > 0 && (
                                            <span className={`text-[9px] min-w-[18px] text-center rounded-full px-1 ${isActive ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-600'}`}>
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>

                        {/* Mobile Tab Bar */}
                        <div className="sm:hidden flex overflow-x-auto border-b bg-gray-50 flex-shrink-0 absolute w-full z-10" style={{ top: 'auto' }}>
                        </div>

                        {/* Content */}
                        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                            {/* Mobile scrollable tabs */}
                            <div className="sm:hidden flex overflow-x-auto border-b bg-gray-50/80 flex-shrink-0 px-1 py-1 gap-0.5">
                                {NAV_ITEMS.map(item => {
                                    const Icon = item.icon;
                                    const isActive = activeTab === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id)}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] whitespace-nowrap transition-all flex-shrink-0 ${
                                                isActive ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-500'
                                            }`}
                                        >
                                            <Icon className={`w-3 h-3 ${isActive ? item.color : 'text-gray-400'}`} />
                                            {item.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex-1 overflow-y-auto p-3 sm:p-5">
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-20">
                                        <div className="text-center">
                                            <div className="animate-spin w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-3"></div>
                                            <p className="text-gray-500 text-sm">טוען מידע...</p>
                                        </div>
                                    </div>
                                ) : loadError ? (
                                    <div className="text-center py-20 text-red-600">
                                        <p className="text-lg font-semibold">שגיאה</p>
                                        <p className="text-sm mt-2">{loadError}</p>
                                        <Button onClick={loadCustomerData} className="mt-4">נסה שוב</Button>
                                    </div>
                                ) : renderContent()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <SendSmsModal isOpen={showSmsModal} onClose={() => setShowSmsModal(false)} phone={customer?.phone} customerName={customer?.full_name} />
        </>
    );
}

function QuickStat({ icon: Icon, label, value }) {
    return (
        <div className="bg-white/10 backdrop-blur rounded-lg px-3 py-2 flex-shrink-0 min-w-[80px]">
            <div className="flex items-center gap-1 mb-0.5">
                <Icon className="w-3 h-3 opacity-80" />
                <span className="text-[10px] opacity-80">{label}</span>
            </div>
            <p className="text-base font-bold">{value}</p>
        </div>
    );
}

function OverviewContent({ customer, stats, repairs, callCount, spOrders, shipments, orders, invoices, onSms }) {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Contact Info */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <User className="w-4 h-4 text-purple-600" />פרטי קשר
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                        {customer?.phone && (
                            <div className="flex items-center gap-2 justify-between">
                                <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                    <Phone className="w-4 h-4 text-green-600" />
                                    {customer.phone}
                                </a>
                                <div className="flex gap-1">
                                    <Button size="sm" variant="outline" onClick={onSms} className="h-7 text-[10px] gap-1">
                                        <MessageCircle className="w-3 h-3" />SMS
                                    </Button>
                                    <Button size="sm" variant="outline" asChild className="h-7">
                                        <a href={`tel:${customer.phone}`}><PhoneIcon className="w-3 h-3" /></a>
                                    </Button>
                                </div>
                            </div>
                        )}
                        {customer?.email && (
                            <a href={`mailto:${customer.email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                <Mail className="w-4 h-4 text-purple-600" />
                                <span className="truncate">{customer.email}</span>
                            </a>
                        )}
                        {(customer?.full_address || customer?.city) && (
                            <div className="flex items-center gap-2 text-sm text-gray-700">
                                <MapPin className="w-4 h-4 text-red-500" />
                                {customer.full_address || customer.city}
                            </div>
                        )}
                        {customer?.preferred_channel && (
                            <div className="flex items-center gap-2 text-sm text-gray-700">
                                <MessageCircle className="w-4 h-4 text-blue-500" />
                                ערוץ מועדף: {customer.preferred_channel}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Activity Summary */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <TrendingUp className="w-4 h-4 text-purple-600" />סיכום פעילות
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                        <SummaryRow label="רכישה אחרונה" value={stats.lastOrderDate ? format(new Date(stats.lastOrderDate), 'dd/MM/yyyy', { locale: he }) : 'אין'} bg="bg-green-50" />
                        <SummaryRow label="ממוצע לרכישה" value={`₪${stats.totalOrders > 0 ? Math.round(stats.totalSpent / (stats.totalOrders + stats.spOrdersCount)) : 0}`} bg="bg-purple-50" />
                        <SummaryRow label="תיקונים פעילים" value={repairs.filter(r => !['תיקון נסגר', 'לא ניתן לתיקון'].includes(r.status)).length} bg="bg-orange-50" />
                        <SummaryRow label="שיחות" value={callCount} bg="bg-teal-50" />
                        <SummaryRow label="הזמנות סופר-פארם" value={stats.spOrdersCount} bg="bg-emerald-50" />
                        <SummaryRow label="משלוחים" value={stats.totalShipments} bg="bg-cyan-50" />
                    </CardContent>
                </Card>
            </div>

            <CustomerAISummary customer={customer} orders={orders} repairs={repairs} tickets={[]} devices={[]} />

            {customer?.notes && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <FileText className="w-4 h-4 text-purple-600" />הערות
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{customer.notes}</p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function SummaryRow({ label, value, bg }) {
    return (
        <div className={`flex justify-between items-center px-3 py-2 ${bg} rounded-lg`}>
            <span className="text-xs text-gray-700">{label}</span>
            <span className="font-semibold text-sm text-gray-900">{value}</span>
        </div>
    );
}