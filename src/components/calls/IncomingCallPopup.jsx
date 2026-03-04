import React, { useState, useEffect, useRef } from 'react';
import { PhoneIncoming, X, User, Ticket, Wrench, Star, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function IncomingCallPopup() {
    const [callData, setCallData] = useState(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const lastSeenRef = useRef(null);
    const processedIdsRef = useRef(new Set());

    useEffect(() => {
        // Poll for recent incoming call activities
        const checkCalls = async () => {
            try {
                const recentCalls = await base44.entities.Activity.filter(
                    { activity_type: 'שיחה נכנסת' },
                    '-created_date',
                    3
                );

                if (recentCalls.length === 0) return;
                
                const latestCall = recentCalls[0];
                const callAge = Date.now() - new Date(latestCall.created_date).getTime();
                
                // Only show popup for calls less than 15 seconds old and not already shown
                if (callAge > 15000 || processedIdsRef.current.has(latestCall.id)) return;

                processedIdsRef.current.add(latestCall.id);
                // Keep set small
                if (processedIdsRef.current.size > 50) {
                    const arr = [...processedIdsRef.current];
                    processedIdsRef.current = new Set(arr.slice(-25));
                }

                // Extract phone from content
                const content = latestCall.content || '';
                const phoneMatch = content.match(/\((\d{10})\)/) || content.match(/- (\d{10})/) || content.match(/(\d{10})/);
                const phone = phoneMatch ? phoneMatch[1] : null;
                
                // Check if it says "לא נענתה" - skip those
                if (content.includes('לא נענתה')) return;

                let customerInfo = null;
                if (phone) {
                    try {
                        const clients = await base44.entities.Client.filter({ phone }, null, 1);
                        if (clients.length > 0) {
                            customerInfo = clients[0];
                            const [tickets, repairs] = await Promise.all([
                                base44.entities.Ticket.filter({ customer_id: customerInfo.id }, '-created_date', 3).catch(() => []),
                                base44.entities.Repair.filter({ client_id: customerInfo.id }, '-created_date', 3).catch(() => []),
                            ]);
                            customerInfo.openTickets = tickets.filter(t => !['סגור', 'בוטל'].includes(t.status));
                            customerInfo.openRepairs = repairs.filter(r => !['תיקון נסגר', 'לא ניתן לתיקון', 'נמסר', 'הושלם', 'בוטל'].includes(r.status));
                        }
                    } catch (_e) { /* silent */ }
                }

                setCallData({
                    activityId: latestCall.id,
                    phone: phone || 'לא ידוע',
                    customer: customerInfo,
                    summary: latestCall.summary,
                });
                setIsVisible(true);
                setIsMinimized(false);

                // Auto-minimize after 30 seconds
                setTimeout(() => setIsMinimized(true), 30000);
            } catch (_e) { /* silent polling */ }
        };

        checkCalls();
        const interval = setInterval(checkCalls, 4000);
        return () => clearInterval(interval);
    }, []);

    if (!isVisible || !callData) return null;

    const customer = callData.customer;

    if (isMinimized) {
        return (
            <div
                onClick={() => setIsMinimized(false)}
                className="fixed bottom-4 left-4 z-[9999] bg-green-500 text-white p-3 rounded-full shadow-2xl cursor-pointer animate-pulse hover:bg-green-600 transition-all"
            >
                <PhoneIncoming className="w-6 h-6" />
            </div>
        );
    }

    return (
        <div dir="rtl" className="fixed bottom-4 left-4 z-[9999] w-80 bg-white rounded-2xl shadow-2xl border-2 border-green-400 overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-3 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <PhoneIncoming className="w-5 h-5 animate-pulse" />
                    <span className="font-bold text-sm">שיחה נכנסת</span>
                </div>
                <div className="flex gap-1">
                    <button onClick={() => setIsMinimized(true)} className="p-1 hover:bg-white/20 rounded text-xs">_</button>
                    <button onClick={() => { setIsVisible(false); setCallData(null); }} className="p-1 hover:bg-white/20 rounded">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="p-4 space-y-3">
                {customer ? (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold">
                                {customer.full_name?.charAt(0) || '?'}
                            </div>
                            <div>
                                <div className="font-bold text-gray-800">{customer.full_name}</div>
                                <div className="text-sm text-gray-500">{callData.phone}</div>
                            </div>
                            {customer.customer_score >= 80 && (
                                <Badge className="bg-amber-100 text-amber-700 text-xs">
                                    <Star className="w-3 h-3 ml-1" /> VIP
                                </Badge>
                            )}
                        </div>

                        <div className="space-y-2">
                            {customer.openTickets?.length > 0 && (
                                <div className="flex items-center gap-2 bg-red-50 p-2 rounded-lg text-sm">
                                    <Ticket className="w-4 h-4 text-red-500 flex-shrink-0" />
                                    <span className="text-red-700">{customer.openTickets.length} טיקטים פתוחים</span>
                                </div>
                            )}
                            {customer.openRepairs?.length > 0 && (
                                <div className="flex items-center gap-2 bg-orange-50 p-2 rounded-lg text-sm">
                                    <Wrench className="w-4 h-4 text-orange-500 flex-shrink-0" />
                                    <span className="text-orange-700">{customer.openRepairs.length} תיקונים בתהליך</span>
                                </div>
                            )}
                        </div>

                        <Link
                            to={createPageUrl('Customers') + `?openCard=${customer.id}`}
                            className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:opacity-90 transition-opacity"
                        >
                            <ExternalLink className="w-4 h-4" />
                            פתח כרטיס לקוח
                        </Link>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                                <User className="w-5 h-5 text-gray-500" />
                            </div>
                            <div>
                                <div className="font-bold text-gray-800">מספר לא מזוהה</div>
                                <div className="text-sm text-gray-500">{callData.phone}</div>
                            </div>
                        </div>
                        <Link
                            to={createPageUrl('Customers') + `?newCustomerPhone=${callData.phone}`}
                            className="flex items-center justify-center gap-2 w-full border border-gray-300 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                        >
                            <User className="w-4 h-4" /> צור לקוח חדש
                        </Link>
                    </>
                )}
            </div>
        </div>
    );
}