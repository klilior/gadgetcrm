import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, RefreshCw, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CallLogItem from '../components/calls/CallLogItem';

const DEDUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

function extractPhone(content) {
    if (!content) return null;
    // Try parentheses first (most reliable)
    const parenMatch = content.match(/\((\d{9,10})\)/);
    if (parenMatch) return parenMatch[1].length === 9 ? '0' + parenMatch[1] : parenMatch[1];
    // Try "מספר: XXXX" pattern
    const numberFieldMatch = content.match(/מספר:\s*(\d{9,10})/);
    if (numberFieldMatch) return numberFieldMatch[1].length === 9 ? '0' + numberFieldMatch[1] : numberFieldMatch[1];
    // Try after dash pattern
    const dashMatch = content.match(/- (\d{10})\b/);
    if (dashMatch) return dashMatch[1];
    // Try international format 972...
    const intlMatch = content.match(/\+?972(\d{9})/) || content.match(/\b972(\d{9})\b/);
    if (intlMatch) return '0' + intlMatch[1];
    // Standalone 10-digit
    const standaloneMatch = content.match(/\b(0\d{9})\b/);
    if (standaloneMatch) return standaloneMatch[1];
    return null;
}

function normalizePhone(phone) {
    if (!phone) return null;
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.length === 12 && digits.startsWith('972')) return '0' + digits.slice(3);
    if (digits.length === 13 && digits.startsWith('9720')) return '0' + digits.slice(4);
    if (digits.length === 9 && !digits.startsWith('0')) return '0' + digits;
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    return digits;
}

/** Deduplicate calls: same phone + same type within window = keep best one. Also group by thread_id. */
function deduplicateCalls(calls) {
    const sorted = [...calls].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    const result = [];
    const seen = []; // {phone, type, time, resultIdx, threadId}
    const threadMap = {}; // thread_id -> resultIdx

    for (const call of sorted) {
        const phone = extractPhone(call.content);
        const normalizedPh = normalizePhone(phone);
        const content = call.content || '';
        const isMissed = content.includes('לא נענתה') || (call.summary || '').includes('לא נענתה');
        const callType = isMissed ? 'missed' : call.activity_type;
        const callTime = new Date(call.created_date).getTime();
        const threadId = call.thread_id;

        // First check: same thread_id = same call session, always merge
        if (threadId && threadMap[threadId] !== undefined) {
            const existingIdx = threadMap[threadId];
            const existing = result[existingIdx];
            const existingContent = existing.content || '';
            const hasBetterInfo = content.length > existingContent.length || 
                (content.includes('משך:') && !existingContent.includes('משך:')) ||
                (call.recording_url && !existing.recording_url);
            if (hasBetterInfo) {
                result[existingIdx] = { ...call, _dupCount: (result[existingIdx]._dupCount || 1) + 1 };
            } else {
                if (!result[existingIdx]._dupCount) result[existingIdx]._dupCount = 1;
                result[existingIdx]._dupCount++;
            }
            continue;
        }

        // Second check: same phone + same type within dedup window
        const lookupPhone = normalizedPh || phone;
        const dupIdx = lookupPhone ? seen.findIndex(s => 
            s.phone === lookupPhone && s.type === callType && Math.abs(s.time - callTime) < DEDUP_WINDOW_MS
        ) : -1;

        if (dupIdx !== -1) {
            const existingIdx = seen[dupIdx].resultIdx;
            const existing = result[existingIdx];
            const existingContent = existing.content || '';
            const hasBetterInfo = content.length > existingContent.length || 
                (content.includes('משך:') && !existingContent.includes('משך:')) ||
                (call.recording_url && !existing.recording_url);
            if (hasBetterInfo) {
                result[existingIdx] = { ...call, _dupCount: (result[existingIdx]._dupCount || 1) + 1 };
            } else {
                if (!result[existingIdx]._dupCount) result[existingIdx]._dupCount = 1;
                result[existingIdx]._dupCount++;
            }
            if (threadId) threadMap[threadId] = existingIdx;
            continue;
        }

        const resultIdx = result.length;
        result.push(call);
        if (lookupPhone) seen.push({ phone: lookupPhone, type: callType, time: callTime, resultIdx });
        if (threadId) threadMap[threadId] = resultIdx;
    }
    return result;
}

export default function CallLog() {
    const [activities, setActivities] = useState([]);
    const [clients, setClients] = useState({});
    const [clientTips, setClientTips] = useState({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');

    const loadData = async () => {
        setLoading(true);
        try {
            const [incoming, outgoing] = await Promise.all([
                base44.entities.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 150),
                base44.entities.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 150),
            ]);

            const allCalls = [...incoming, ...outgoing].sort((a, b) => 
                new Date(b.created_date) - new Date(a.created_date)
            );
            setActivities(allCalls);

            // Extract unique phone numbers and look up clients
            const phones = new Set();
            allCalls.forEach(call => {
                const phone = extractPhone(call.content);
                if (phone) phones.add(phone);
            });

            const clientMap = {};
            const phonesArr = [...phones];
            // Batch lookups in parallel (max 10 at a time)
            for (let i = 0; i < phonesArr.length; i += 10) {
                const batch = phonesArr.slice(i, i + 10);
                const results = await Promise.all(
                    batch.map(async (phone) => {
                        const normalized = normalizePhone(phone);
                        // Try exact match first
                        let res = await base44.entities.Client.filter({ phone: normalized }, null, 1).catch(() => []);
                        if (res.length > 0) return res;
                        // Try with 972 prefix
                        if (normalized?.startsWith('0')) {
                            res = await base44.entities.Client.filter({ phone: '972' + normalized.slice(1) }, null, 1).catch(() => []);
                            if (res.length > 0) return res;
                            res = await base44.entities.Client.filter({ phone: '+972' + normalized.slice(1) }, null, 1).catch(() => []);
                            if (res.length > 0) return res;
                        }
                        return [];
                    })
                );
                results.forEach((res, idx) => {
                    if (res.length > 0) {
                        clientMap[batch[idx]] = res[0];
                        // Also map the normalized version
                        const norm = normalizePhone(batch[idx]);
                        if (norm) clientMap[norm] = res[0];
                    }
                });
            }
            setClients(clientMap);

            // Generate AI tips for identified clients
            generateTips(clientMap);
        } catch (e) {
            console.error('Error loading calls:', e);
        }
        setLoading(false);
    };

    const generateTips = async (clientMap) => {
        const uniqueClients = {};
        Object.values(clientMap).forEach(c => { uniqueClients[c.id] = c; });
        
        const clientIds = Object.keys(uniqueClients);
        if (clientIds.length === 0) return;

        // Fetch recent activities for all identified clients (limit work)
        const tipsMap = {};
        
        // Process in batches of 5 clients
        for (let i = 0; i < Math.min(clientIds.length, 20); i += 5) {
            const batch = clientIds.slice(i, i + 5);
            const batchPromises = batch.map(async (clientId) => {
                const client = uniqueClients[clientId];
                try {
                    const [tickets, repairs, orders, allActivities] = await Promise.all([
                        base44.entities.Ticket.filter({ customer_id: clientId }, '-created_date', 5).catch(() => []),
                        base44.entities.Repair.filter({ client_id: clientId }, '-created_date', 5).catch(() => []),
                        base44.entities.Order.filter({ client_id: clientId }, '-order_date', 5).catch(() => []),
                        base44.entities.Activity.filter({ ticket_id: clientId }, '-created_date', 10).catch(() => []),
                    ]);

                    const openTickets = tickets.filter(t => !['סגור', 'נסגר', 'נסגר ללא מענה', 'בוטל'].includes(t.status));
                    const openRepairs = repairs.filter(r => !['תיקון נסגר', 'לא ניתן לתיקון', 'נמסר', 'הושלם', 'בוטל'].includes(r.status));
                    const closedRepairs = repairs.filter(r => ['תיקון נסגר', 'נמסר', 'הושלם'].includes(r.status));
                    const pendingOrders = orders.filter(o => o.status === 'pending');
                    const now = new Date();
                    const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
                    const recentCompletedOrders = orders.filter(o => ['processing', 'completed'].includes(o.status) && new Date(o.order_date) >= threeDaysAgo);

                    // Count recent contacts (calls/tickets in last 7 days) for "multiple contacts" detection
                    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                    const recentTickets = tickets.filter(t => new Date(t.created_date) >= sevenDaysAgo);

                    // Build structured context
                    const facts = [];
                    facts.push(`לקוח: ${client.full_name}, דרגה: ${client.customer_tier || 'חדש'}, סה"כ הזמנות: ${client.total_orders || 0}, סה"כ רכישות: ₪${client.total_spent || 0}`);
                    
                    if (pendingOrders.length > 0) {
                        facts.push(`⚠️ חשוב! יש ${pendingOrders.length} הזמנות בסטטוס "ממתין לתשלום" - סכום: ₪${pendingOrders.reduce((s,o) => s + (parseFloat(o.total)||0), 0)} - תאריכים: ${pendingOrders.map(o => new Date(o.order_date).toLocaleDateString('he-IL')).join(', ')}`);
                    }
                    if (recentCompletedOrders.length > 0) {
                        facts.push(`📦 הזמנה שהושלמה ב-3 ימים אחרונים: ₪${recentCompletedOrders[0].total} בתאריך ${new Date(recentCompletedOrders[0].order_date).toLocaleDateString('he-IL')}`);
                    }
                    if (openTickets.length > 0) {
                        facts.push(`פניות שירות פתוחות: ${openTickets.map(t => `"${t.subject}" (${t.status}${t.priority === 'דחוף' ? ' - דחוף!' : ''})`).join(', ')}`);
                    }
                    if (recentTickets.length >= 3) {
                        facts.push(`⚠️ ריבוי פניות! ${recentTickets.length} פניות ב-7 ימים אחרונים - ייתכן שהלקוח לא מטופל כראוי`);
                    }
                    if (openRepairs.length > 0) {
                        facts.push(`תיקונים פעילים: ${openRepairs.map(r => `${r.issue_category || 'מכשיר'} - ${r.status} (${r.repair_type || ''})`).join(', ')}`);
                    }
                    if (closedRepairs.length > 0) {
                        const lastClosed = closedRepairs[0];
                        const closedDate = new Date(lastClosed.updated_date);
                        const daysSinceClosed = Math.floor((now - closedDate) / (1000*60*60*24));
                        if (daysSinceClosed <= 7) facts.push(`תיקון נסגר לפני ${daysSinceClosed} ימים - ייתכן בירור/תלונה`);
                    }
                    if (orders.length > 0 && !pendingOrders.length && !recentCompletedOrders.length) {
                        const lastOrder = orders[0];
                        facts.push(`הזמנה אחרונה: ${lastOrder.status} ₪${lastOrder.total} בתאריך ${new Date(lastOrder.order_date).toLocaleDateString('he-IL')}`);
                    }

                    if (facts.length <= 1) {
                        tipsMap[clientId] = 'אין פעילות ידועה';
                        return;
                    }

                    const res = await base44.integrations.Core.InvokeLLM({
                        prompt: `אתה יועץ מכירות חכם במערכת CRM. לקוח מתקשר עכשיו. על סמך המידע הבא, כתוב התראה ממוקדת (עד 20 מילים) שתעזור לנציג לסגור עסקה או לטפל בבעיה.

כללי חשיבה:
- הזמנה בסטטוס "ממתין לתשלום" = הלקוח רוצה לשלם! זו הזדמנות מכירה חמה. ציין את הסכום.
- הזמנה שהושלמה ב-3 ימים אחרונים = כנראה בירור על משלוח/מעקב
- ריבוי פניות = לקוח מתוסכל, צריך טיפול מיוחד
- תיקון פעיל = כנראה רוצה עדכון סטטוס
- תיקון שנסגר לאחרונה = ייתכן תלונה או בירור
- פניות שירות פתוחות = בדוק מה הסטטוס ועדכן
- אם אין בעיות = הזדמנות למכירה, ציין רקע

אל תכתוב "הלקוח". התחל ישר עם התוכן. השתמש באימוג'י אחד מתאים בתחילת המשפט.

מידע:
${facts.join('\n')}`,
                        response_json_schema: {
                            type: "object",
                            properties: {
                                tip: { type: "string", description: "התראה ממוקדת לנציג" }
                            }
                        }
                    });
                    tipsMap[clientId] = res?.tip || 'אין מידע';
                } catch (_e) {
                    tipsMap[clientId] = null;
                }
            });
            await Promise.all(batchPromises);
        }
        
        setClientTips(prev => ({ ...prev, ...tipsMap }));
    };

    useEffect(() => { loadData(); }, []);

    // Deduplicate then filter
    const dedupedCalls = useMemo(() => deduplicateCalls(activities), [activities]);

    const filteredCalls = useMemo(() => {
        return dedupedCalls.filter(call => {
            const content = call.content || '';
            const summary = call.summary || '';
            const phone = extractPhone(content);
            const normalized = normalizePhone(phone);
            const client = (phone && clients[phone]) || (normalized && clients[normalized]) || null;
            const clientName = client?.full_name || '';

            const isMissed = content.includes('לא נענתה') || summary.includes('לא נענתה');
            const isIncoming = call.activity_type === 'שיחה נכנסת';
            const isOutgoing = call.activity_type === 'שיחה יוצאת';

            if (filter === 'incoming' && (!isIncoming || isMissed)) return false;
            if (filter === 'outgoing' && !isOutgoing) return false;
            if (filter === 'missed' && !isMissed) return false;

            if (search) {
                const q = search.toLowerCase();
                return (phone && phone.includes(q)) || 
                       clientName.toLowerCase().includes(q) ||
                       summary.toLowerCase().includes(q) ||
                       content.toLowerCase().includes(q);
            }
            return true;
        });
    }, [dedupedCalls, clients, filter, search]);

    const stats = useMemo(() => {
        const total = dedupedCalls.length;
        const incoming = dedupedCalls.filter(a => a.activity_type === 'שיחה נכנסת' && !(a.content || '').includes('לא נענתה') && !(a.summary || '').includes('לא נענתה')).length;
        const outgoing = dedupedCalls.filter(a => a.activity_type === 'שיחה יוצאת').length;
        const missed = dedupedCalls.filter(a => (a.content || '').includes('לא נענתה') || (a.summary || '').includes('לא נענתה')).length;
        return { total, incoming, outgoing, missed };
    }, [dedupedCalls]);

    return (
        <div dir="rtl" className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Phone className="w-6 h-6 text-purple-600" />
                        יומן שיחות
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">כל השיחות הנכנסות והיוצאות</p>
                </div>
                <Button onClick={loadData} variant="outline" size="sm" disabled={loading}>
                    <RefreshCw className={`w-4 h-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
                    רענן
                </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="סה״כ שיחות" value={stats.total} icon={Phone} color="purple" />
                <StatCard label="נכנסות" value={stats.incoming} icon={PhoneIncoming} color="green" />
                <StatCard label="יוצאות" value={stats.outgoing} icon={PhoneOutgoing} color="blue" />
                <StatCard label="לא נענו" value={stats.missed} icon={PhoneMissed} color="red" />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        placeholder="חיפוש לפי שם, טלפון..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pr-10"
                    />
                </div>
                <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="w-full sm:w-44">
                        <Filter className="w-4 h-4 ml-2" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">כל השיחות</SelectItem>
                        <SelectItem value="incoming">נכנסות</SelectItem>
                        <SelectItem value="outgoing">יוצאות</SelectItem>
                        <SelectItem value="missed">לא נענו</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {loading ? (
                <div className="text-center py-12 text-gray-500">טוען שיחות...</div>
            ) : filteredCalls.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                    <Phone className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>לא נמצאו שיחות</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl border shadow-sm divide-y">
                    {filteredCalls.map(call => {
                        const phone = extractPhone(call.content);
                        const normalized = normalizePhone(phone);
                        const client = (phone && clients[phone]) || (normalized && clients[normalized]) || null;
                        const tip = client ? clientTips[client.id] : null;
                        return (
                            <CallLogItem
                                key={call.id}
                                call={call}
                                client={client}
                                aiTip={tip}
                                dupCount={call._dupCount || 0}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function StatCard({ label, value, icon: Icon, color }) {
    const colors = {
        purple: 'bg-purple-50 text-purple-700 border-purple-200',
        green: 'bg-green-50 text-green-700 border-green-200',
        blue: 'bg-blue-50 text-blue-700 border-blue-200',
        red: 'bg-red-50 text-red-700 border-red-200',
    };
    return (
        <div className={`rounded-xl border p-3 ${colors[color]}`}>
            <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{label}</span>
            </div>
            <div className="text-2xl font-bold">{value}</div>
        </div>
    );
}

export { extractPhone };