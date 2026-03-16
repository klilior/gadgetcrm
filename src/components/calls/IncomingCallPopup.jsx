import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PhoneIncoming, X, User, Ticket, Wrench, Star, ExternalLink, Bell, ShoppingCart, CreditCard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import CallContextInsight from './CallContextInsight';

// Request browser notification permission on load
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotification(title, body, onClick) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body,
      icon: '📞',
      tag: 'incoming-call',
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      if (onClick) onClick();
      notification.close();
    };
    // Auto close after 30s
    setTimeout(() => notification.close(), 30000);
  }
}

export default function IncomingCallPopup() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [callData, setCallData] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [permissionState, setPermissionState] = useState(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const processedIdsRef = useRef(new Set());
  const minimizeTimerRef = useRef(null);

  // Track screen size
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Request notification permission (desktop only)
  useEffect(() => {
    if (!isMobile) requestNotificationPermission();
  }, [isMobile]);

  const handleNewCall = useCallback(async (activity) => {
    // Only handle incoming calls
    if (activity.activity_type !== 'שיחה נכנסת') return;

    // Skip already processed
    if (processedIdsRef.current.has(activity.id)) return;
    processedIdsRef.current.add(activity.id);

    // Keep set small
    if (processedIdsRef.current.size > 100) {
      const arr = [...processedIdsRef.current];
      processedIdsRef.current = new Set(arr.slice(-50));
    }

    // Skip missed/unanswered calls
    const content = activity.content || '';
    if (content.includes('לא נענתה')) return;

    // Extract phone from content
    const phoneMatch = content.match(/\((\d{10})\)/) || content.match(/- (\d{10})/) || content.match(/(\d{10})/);
    const phone = phoneMatch ? phoneMatch[1] : null;

    // Lookup customer
    let customerInfo = null;
    if (phone) {
      try {
        // Search with phone variants for better matching
        let clients = await base44.entities.Client.filter({ phone }, null, 1);
        if (clients.length === 0 && phone.startsWith('0') && phone.length === 10) {
          clients = await base44.entities.Client.filter({ phone: '972' + phone.slice(1) }, null, 1).catch(() => []);
          if (clients.length === 0) {
            clients = await base44.entities.Client.filter({ phone: '+972' + phone.slice(1) }, null, 1).catch(() => []);
          }
        }
        if (clients.length > 0) {
          customerInfo = clients[0];
          const [tickets, repairs, orders, devices, invoices] = await Promise.all([
            base44.entities.Ticket.filter({ customer_id: customerInfo.id }, '-created_date', 5).catch(() => []),
            base44.entities.Repair.filter({ client_id: customerInfo.id }, '-created_date', 5).catch(() => []),
            base44.entities.Order.filter({ client_id: customerInfo.id }, '-order_date', 10).catch(() => []),
            base44.entities.RepairDevice.filter({ client_id: customerInfo.id }, '-created_date', 10).catch(() => []),
            base44.entities.SalesTransaction.filter({ client_id: customerInfo.id }, '-issue_date', 20).catch(() => []),
          ]);
          customerInfo.allTickets = tickets;
          customerInfo.allRepairs = repairs;
          customerInfo.allOrders = orders;
          customerInfo.allDevices = devices;
          customerInfo.allInvoices = invoices;
          customerInfo.openTickets = tickets.filter(t => !['נסגר', 'נסגר ללא מענה', 'בוטל'].includes(t.status));
          customerInfo.openRepairs = repairs.filter(r => !['תיקון נסגר', 'לא ניתן לתיקון', 'נמסר', 'הושלם', 'בוטל'].includes(r.status));
          customerInfo.pendingOrders = orders.filter(o => o.status === 'pending');
          customerInfo.recentCompletedOrders = orders.filter(o => {
            if (!['processing', 'completed'].includes(o.status)) return false;
            const orderDate = new Date(o.order_date);
            const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
            return orderDate >= threeDaysAgo;
          });
        }
      } catch (_e) { /* silent */ }
    }

    const newCallData = {
      activityId: activity.id,
      phone: phone || 'לא ידוע',
      customer: customerInfo,
      summary: activity.summary,
    };

    setCallData(newCallData);
    setIsVisible(true);
    setIsMinimized(false);

    // Clear previous timer
    if (minimizeTimerRef.current) clearTimeout(minimizeTimerRef.current);
    minimizeTimerRef.current = setTimeout(() => setIsMinimized(true), 30000);

    // Show browser notification (works even when tab is in background!)
    const notifTitle = customerInfo
      ? `📞 שיחה נכנסת מ-${customerInfo.full_name}`
      : `📞 שיחה נכנסת - ${phone || 'לא ידוע'}`;

    const notifBody = customerInfo
      ? [
          phone,
          customerInfo.pendingOrders?.length > 0 ? `💳 ${customerInfo.pendingOrders.length} הזמנות ממתינות לתשלום!` : null,
          customerInfo.recentCompletedOrders?.length > 0 ? `📦 הזמנה ב-3 ימים אחרונים` : null,
          customerInfo.openTickets?.length > 0 ? `${customerInfo.openTickets.length} טיקטים פתוחים` : null,
          customerInfo.openRepairs?.length > 0 ? `${customerInfo.openRepairs.length} תיקונים` : null,
          customerInfo.customer_score >= 80 ? '⭐ VIP' : null,
        ].filter(Boolean).join(' • ')
      : phone || 'מספר לא מזוהה';

    showBrowserNotification(notifTitle, notifBody);

    // Also play a subtle sound
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.15;
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (_e) { /* no audio context available */ }
  }, []);

  // Subscribe to real-time Activity changes
  useEffect(() => {
    const unsubscribe = base44.entities.Activity.subscribe((event) => {
      if (event.type === 'create' && event.data) {
        handleNewCall(event.data);
      }
    });

    return () => {
      unsubscribe();
      if (minimizeTimerRef.current) clearTimeout(minimizeTimerRef.current);
    };
  }, [handleNewCall]);

  // Also do a one-time poll on mount for very recent calls (in case subscription missed it)
  useEffect(() => {
    const checkRecent = async () => {
      try {
        const recentCalls = await base44.entities.Activity.filter(
          { activity_type: 'שיחה נכנסת' },
          '-created_date',
          1
        );
        if (recentCalls.length > 0) {
          const callAge = Date.now() - new Date(recentCalls[0].created_date).getTime();
          if (callAge < 10000) {
            handleNewCall(recentCalls[0]);
          }
        }
      } catch (_e) { /* silent */ }
    };
    checkRecent();
  }, [handleNewCall]);

  const handleRequestPermission = async () => {
    if ('Notification' in window) {
      const result = await Notification.requestPermission();
      setPermissionState(result);
    }
  };

  // Don't render anything on mobile
  if (isMobile) return null;

  if (!isVisible || !callData) {
    // Show a small permission prompt if not granted
    if (permissionState === 'default') {
      return (
        <button
          onClick={handleRequestPermission}
          className="fixed bottom-4 left-4 z-[9999] bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg text-sm flex items-center gap-2 hover:bg-blue-600 transition-all animate-bounce"
          dir="rtl"
        >
          <Bell className="w-4 h-4" />
          אפשר התראות שיחות
        </button>
      );
    }
    return null;
  }

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
    <div dir="rtl" className="fixed bottom-4 left-4 z-[9999] w-96 bg-white rounded-2xl shadow-2xl border-2 border-green-400 overflow-hidden animate-in slide-in-from-bottom-5">
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
              {customer.pendingOrders?.length > 0 && (
                <div className="flex items-center gap-2 bg-yellow-50 p-2 rounded-lg text-sm border border-yellow-300 animate-pulse">
                  <CreditCard className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                  <span className="text-yellow-800 font-semibold">
                    💳 {customer.pendingOrders.length} הזמנות ממתינות לתשלום! (₪{customer.pendingOrders.reduce((s,o) => s + (parseFloat(o.total)||0), 0).toLocaleString()})
                  </span>
                </div>
              )}
              {customer.recentCompletedOrders?.length > 0 && !customer.pendingOrders?.length && (
                <div className="flex items-center gap-2 bg-blue-50 p-2 rounded-lg text-sm">
                  <ShoppingCart className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  <span className="text-blue-700">📦 הזמנה ב-3 ימים אחרונים - כנראה בירור משלוח</span>
                </div>
              )}
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

            {/* AI Context Insight */}
            <CallContextInsight
              customer={customer}
              orders={customer.allOrders}
              repairs={customer.allRepairs}
              tickets={customer.allTickets}
              devices={customer.allDevices}
              invoices={customer.allInvoices}
            />

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