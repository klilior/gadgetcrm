import React from "react";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Phone, Mail, Globe } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";

const getChannelIcon = (channel) => {
    switch (channel) {
        case "whatsapp": return <MessageSquare className="w-4 h-4 text-green-600" />;
        case "phone": return <Phone className="w-4 h-4 text-blue-600" />;
        case "email": return <Mail className="w-4 h-4 text-purple-600" />;
        case "website": return <Globe className="w-4 h-4 text-indigo-600" />;
        default: return <MessageSquare className="w-4 h-4 text-gray-400" />;
    }
};

const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isToday(d)) return format(d, 'HH:mm');
    if (isYesterday(d)) return 'אתמול';
    return format(d, 'dd/MM');
};

export default function ConversationList({ conversations, selectedId, onSelect, searchTerm }) {
    const filtered = conversations.filter(conv => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return conv.customer?.full_name?.toLowerCase().includes(search) ||
               conv.customer?.phone?.includes(search) ||
               conv.last_message?.toLowerCase().includes(search);
    });

    return (
        <div className="h-full overflow-y-auto space-y-1">
            {filtered.map(conv => (
                <div
                    key={conv.id}
                    onClick={() => onSelect(conv)}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                        selectedId === conv.id 
                            ? 'bg-blue-50 border-2 border-blue-500' 
                            : 'bg-white hover:bg-gray-50 border-2 border-transparent'
                    }`}
                >
                    <div className="flex items-start justify-between mb-1">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            {getChannelIcon(conv.last_channel)}
                            <span className="font-semibold text-gray-900 truncate">
                                {conv.customer?.full_name || conv.customer?.phone || 'לא ידוע'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {conv.unread_count > 0 && (
                                <Badge className="bg-red-500 text-white rounded-full px-2 py-0.5 text-xs">
                                    {conv.unread_count}
                                </Badge>
                            )}
                            <span className="text-xs text-gray-500">
                                {formatDate(conv.last_message_date)}
                            </span>
                        </div>
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                        {conv.last_message || 'אין הודעות'}
                    </p>
                    {conv.tags && conv.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                            {conv.tags.slice(0, 2).map(tag => (
                                <span key={tag} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            ))}
            {filtered.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <MessageSquare className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                    <p>אין שיחות להצגה</p>
                </div>
            )}
        </div>
    );
}