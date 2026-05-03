import React from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, User, ExternalLink, Clock, Lightbulb, Copy, CreditCard, ShoppingCart, Mic, Flame, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import moment from 'moment';

export default function CallLogItem({ call, client, aiTip, dupCount, activeLeads = [] }) {
    const content = call.content || '';
    const summary = call.summary || '';
    const isIncoming = call.activity_type === 'שיחה נכנסת';
    const isMissed = content.includes('לא נענתה') || summary.includes('לא נענתה');
    
    // Extract phone - try multiple patterns
    const parenMatch = content.match(/\((\d{9,10})\)/);
    const numberFieldMatch = content.match(/מספר:\s*(\d{9,10})/);
    const dashMatch = content.match(/- (\d{10})\b/);
    const intlMatch = content.match(/\+?972(\d{9})/);
    const standaloneMatch = content.match(/\b(0\d{9})\b/);
    
    let phone = 'לא ידוע';
    if (parenMatch) phone = parenMatch[1].length === 9 ? '0' + parenMatch[1] : parenMatch[1];
    else if (numberFieldMatch) phone = numberFieldMatch[1].length === 9 ? '0' + numberFieldMatch[1] : numberFieldMatch[1];
    else if (dashMatch) phone = dashMatch[1];
    else if (intlMatch) phone = '0' + intlMatch[1];
    else if (standaloneMatch) phone = standaloneMatch[1];
    
    // Extract extension
    const extMatch = content.match(/שלוחה: (\d+)/);
    const extension = extMatch ? extMatch[1] : '';

    // Extract duration
    const durMatch = content.match(/משך: (\d+) שניות/);
    const durationSec = durMatch ? parseInt(durMatch[1]) : null;
    const durationFormatted = durationSec != null 
        ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
        : null;

    // Icon and color
    let Icon, iconColor, statusLabel, statusBg;
    if (isMissed) {
        Icon = PhoneMissed;
        iconColor = 'text-red-500';
        statusLabel = 'לא נענתה';
        statusBg = 'bg-red-100 text-red-700';
    } else if (isIncoming) {
        Icon = PhoneIncoming;
        iconColor = 'text-green-500';
        statusLabel = 'נכנסת';
        statusBg = 'bg-green-100 text-green-700';
    } else {
        Icon = PhoneOutgoing;
        iconColor = 'text-blue-500';
        statusLabel = 'יוצאת';
        statusBg = 'bg-blue-100 text-blue-700';
    }

    const timeStr = moment.utc(call.created_date).local().format('DD/MM HH:mm');
    const timeAgo = moment.utc(call.created_date).local().fromNow();

    return (
        <div className="px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3">
                {/* Icon */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isMissed ? 'bg-red-50' : isIncoming ? 'bg-green-50' : 'bg-blue-50'}`}>
                    <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>

                {/* Main Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        {client ? (
                            <Link
                                to={createPageUrl('Customers') + `?openCard=${client.id}`}
                                className="font-semibold text-gray-800 hover:text-purple-600 transition-colors flex items-center gap-1"
                            >
                                {client.full_name}
                                <ExternalLink className="w-3 h-3 text-gray-400" />
                            </Link>
                        ) : (
                            <span className="font-medium text-gray-600 flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-gray-400" />
                                לא מזוהה
                            </span>
                        )}
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusBg} border-0`}>
                            {statusLabel}
                        </Badge>
                        {dupCount > 0 && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-gray-100 text-gray-500 border-0">
                                <Copy className="w-2.5 h-2.5 ml-0.5" />
                                {dupCount + 1} ניסיונות
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        <span className="font-mono">{phone}</span>
                        {extension && <span>שלוחה {extension}</span>}
                        {durationFormatted && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{durationFormatted}</span>}
                    </div>
                </div>

                {/* Time */}
                <div className="text-left flex-shrink-0">
                    <div className="text-xs text-gray-500">{timeStr}</div>
                    <div className="text-[10px] text-gray-400">{timeAgo}</div>
                </div>
            </div>

            {/* Pending orders alert */}
            {client?.pendingOrders?.length > 0 && (
                <div className="mt-2 flex items-center gap-2 bg-yellow-50 border border-yellow-300 rounded-lg px-3 py-2 mr-[52px] animate-pulse">
                    <CreditCard className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                    <span className="text-xs text-yellow-800 font-semibold">
                        💳 {client.pendingOrders.length} הזמנות ממתינות לתשלום! סכום: ₪{client.pendingOrders.reduce((s,o) => s + (parseFloat(o.total)||0), 0).toLocaleString()}
                    </span>
                </div>
            )}
            {/* Active sales lead */}
            {activeLeads.length > 0 && (
                <div className="mt-2 flex items-center gap-2 bg-orange-50 border border-orange-300 rounded-lg px-3 py-2 mr-[52px] animate-pulse">
                    <Flame className="w-4 h-4 text-orange-600 flex-shrink-0" />
                    <span className="text-xs text-orange-800 font-semibold">
                        🔥 ליד מכירה פעיל! {activeLeads.map(l => l.topic).join(', ')}
                    </span>
                </div>
            )}
            {/* Recent completed order */}
            {client?.recentCompletedOrders?.length > 0 && !client?.pendingOrders?.length && (
                <div className="mt-2 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 mr-[52px]">
                    <ShoppingCart className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-xs text-blue-700">📦 הזמנה ב-3 ימים אחרונים - כנראה בירור משלוח</span>
                </div>
            )}
            {/* AI Tip */}
            {client && aiTip && aiTip !== 'אין מידע' && aiTip !== 'אין פעילות ידועה' && (
                <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mr-[52px]">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-800 leading-relaxed">{aiTip}</span>
                </div>
            )}
            {client && aiTip === 'אין פעילות ידועה' && (
                <div className="mt-2 flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 mr-[52px]">
                    <span className="text-[11px] text-gray-400">אין פעילות ידועה ללקוח</span>
                </div>
            )}
            {/* Recording */}
            {call.recording_url && (
                <div className="mt-2 mr-[52px] flex items-center gap-2">
                    <Mic className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                    {call.recording_url.includes('drive.google.com') ? (
                        <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
                           className="text-xs text-purple-600 hover:text-purple-800 underline flex items-center gap-1">
                            <Link2 className="w-3 h-3" />
                            האזנה להקלטה (Google Drive)
                        </a>
                    ) : (
                        <audio controls preload="none" className="h-8 flex-1 max-w-sm">
                            <source src={call.recording_url} />
                        </audio>
                    )}
                </div>
            )}
        </div>
    );
}