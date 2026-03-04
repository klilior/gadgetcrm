import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, RefreshCw, User, Clock, ExternalLink, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import CallLogItem from '../components/calls/CallLogItem';

export default function CallLog() {
    const [activities, setActivities] = useState([]);
    const [clients, setClients] = useState({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all'); // all, incoming, outgoing, missed

    const loadData = async () => {
        setLoading(true);
        try {
            const [incoming, outgoing] = await Promise.all([
                base44.entities.Activity.filter({ activity_type: 'שיחה נכנסת' }, '-created_date', 100),
                base44.entities.Activity.filter({ activity_type: 'שיחה יוצאת' }, '-created_date', 100),
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
            for (const phone of phones) {
                try {
                    const results = await base44.entities.Client.filter({ phone }, null, 1);
                    if (results.length > 0) clientMap[phone] = results[0];
                } catch (_e) { /* skip */ }
            }
            setClients(clientMap);
        } catch (e) {
            console.error('Error loading calls:', e);
        }
        setLoading(false);
    };

    useEffect(() => { loadData(); }, []);

    const filteredCalls = useMemo(() => {
        return activities.filter(call => {
            const content = call.content || '';
            const summary = call.summary || '';
            const phone = extractPhone(content);
            const client = phone ? clients[phone] : null;
            const clientName = client?.full_name || '';

            // Filter by type
            const isMissed = content.includes('לא נענתה');
            const isIncoming = call.activity_type === 'שיחה נכנסת';
            const isOutgoing = call.activity_type === 'שיחה יוצאת';

            if (filter === 'incoming' && (!isIncoming || isMissed)) return false;
            if (filter === 'outgoing' && !isOutgoing) return false;
            if (filter === 'missed' && !isMissed) return false;

            // Search
            if (search) {
                const q = search.toLowerCase();
                return (phone && phone.includes(q)) || 
                       clientName.toLowerCase().includes(q) ||
                       summary.toLowerCase().includes(q) ||
                       content.toLowerCase().includes(q);
            }
            return true;
        });
    }, [activities, clients, filter, search]);

    // Stats
    const stats = useMemo(() => {
        const total = activities.length;
        const incoming = activities.filter(a => a.activity_type === 'שיחה נכנסת' && !(a.content || '').includes('לא נענתה')).length;
        const outgoing = activities.filter(a => a.activity_type === 'שיחה יוצאת').length;
        const missed = activities.filter(a => (a.content || '').includes('לא נענתה')).length;
        const identified = activities.filter(a => {
            const phone = extractPhone(a.content);
            return phone && clients[phone];
        }).length;
        return { total, incoming, outgoing, missed, identified };
    }, [activities, clients]);

    return (
        <div dir="rtl" className="space-y-4">
            {/* Header */}
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

            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="סה״כ שיחות" value={stats.total} icon={Phone} color="purple" />
                <StatCard label="נכנסות" value={stats.incoming} icon={PhoneIncoming} color="green" />
                <StatCard label="יוצאות" value={stats.outgoing} icon={PhoneOutgoing} color="blue" />
                <StatCard label="לא נענו" value={stats.missed} icon={PhoneMissed} color="red" />
            </div>

            {/* Filters */}
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

            {/* Call List */}
            {loading ? (
                <div className="text-center py-12 text-gray-500">טוען שיחות...</div>
            ) : filteredCalls.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                    <Phone className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>לא נמצאו שיחות</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl border shadow-sm divide-y">
                    {filteredCalls.map(call => (
                        <CallLogItem
                            key={call.id}
                            call={call}
                            client={clients[extractPhone(call.content)]}
                        />
                    ))}
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

export function extractPhone(content) {
    if (!content) return null;
    const match = content.match(/\((\d{10})\)/) || content.match(/- (\d{10})/) || content.match(/(\d{10})/);
    return match ? match[1] : null;
}