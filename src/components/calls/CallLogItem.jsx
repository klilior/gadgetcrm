import React from 'react';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, User, ExternalLink, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import moment from 'moment';

export default function CallLogItem({ call, client }) {
    const content = call.content || '';
    const isIncoming = call.activity_type === 'שיחה נכנסת';
    const isMissed = content.includes('לא נענתה');
    
    // Extract phone
    const phoneMatch = content.match(/\((\d{10})\)/) || content.match(/- (\d{10})/) || content.match(/(\d{10})/);
    const phone = phoneMatch ? phoneMatch[1] : 'לא ידוע';
    
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

    const timeStr = moment(call.created_date).format('DD/MM HH:mm');
    const timeAgo = moment(call.created_date).fromNow();

    return (
        <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
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
    );
}