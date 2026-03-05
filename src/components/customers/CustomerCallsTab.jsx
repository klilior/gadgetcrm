import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

function parseDuration(content) {
    const match = content?.match(/משך:\s*(\d+)\s*שניות/);
    if (!match) return null;
    const secs = parseInt(match[1]);
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return mins > 0 ? `${mins}:${String(remainSecs).padStart(2, '0')} דק'` : `${secs} שניות`;
}

function parseExtension(content) {
    const match = content?.match(/שלוחה:\s*(\d+)/);
    return match ? match[1] : null;
}

function parseStatus(content) {
    if (content?.includes('הסתיימה')) return { label: 'הסתיימה', color: 'bg-green-100 text-green-700' };
    if (content?.includes('לא נענתה')) return { label: 'לא נענתה', color: 'bg-red-100 text-red-700' };
    if (content?.includes('ננטשה')) return { label: 'ננטשה', color: 'bg-orange-100 text-orange-700' };
    return { label: 'לא ידוע', color: 'bg-gray-100 text-gray-600' };
}

export default function CustomerCallsTab({ activities }) {
    const calls = activities.filter(a => 
        a.activity_type === 'שיחה נכנסת' || a.activity_type === 'שיחה יוצאת'
    ).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

    if (calls.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Phone className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין שיחות ללקוח זה</p>
            </div>
        );
    }

    const incoming = calls.filter(c => c.activity_type === 'שיחה נכנסת').length;
    const outgoing = calls.filter(c => c.activity_type === 'שיחה יוצאת').length;

    return (
        <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
                <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700 px-3 py-1">
                    <PhoneIncoming className="w-3.5 h-3.5 ml-1" />
                    {incoming} נכנסות
                </Badge>
                <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-700 px-3 py-1">
                    <PhoneOutgoing className="w-3.5 h-3.5 ml-1" />
                    {outgoing} יוצאות
                </Badge>
                <Badge variant="outline" className="bg-gray-50 border-gray-200 text-gray-700 px-3 py-1">
                    סה"כ {calls.length} שיחות
                </Badge>
            </div>

            {calls.map(call => {
                const isIncoming = call.activity_type === 'שיחה נכנסת';
                const duration = parseDuration(call.content);
                const extension = parseExtension(call.content);
                const status = parseStatus(call.content);

                return (
                    <Card key={call.id} className="hover:shadow-lg transition-shadow">
                        <CardContent className="p-4">
                            <div className="flex justify-between items-start">
                                <div className="flex items-start gap-3">
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        isIncoming ? 'bg-green-100' : 'bg-blue-100'
                                    }`}>
                                        {isIncoming 
                                            ? <PhoneIncoming className="w-4 h-4 text-green-600" />
                                            : <PhoneOutgoing className="w-4 h-4 text-blue-600" />
                                        }
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-sm">{call.activity_type}</span>
                                            <Badge className={`text-[10px] ${status.color}`}>{status.label}</Badge>
                                        </div>
                                        <div className="flex gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
                                            {duration && (
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" /> {duration}
                                                </span>
                                            )}
                                            {extension && <span>שלוחה: {extension}</span>}
                                        </div>
                                        {call.summary && (
                                            <p className="text-xs text-gray-600 mt-1.5">{call.summary}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="text-left flex-shrink-0">
                                    <span className="text-xs text-gray-500">
                                        {call.created_date ? format(new Date(call.created_date), 'dd/MM/yyyy', { locale: he }) : ''}
                                    </span>
                                    <br />
                                    <span className="text-xs text-gray-400">
                                        {call.created_date ? format(new Date(call.created_date), 'HH:mm', { locale: he }) : ''}
                                    </span>
                                </div>
                            </div>
                            {call.recording_url && (
                                <div className="mt-3">
                                    <audio controls className="w-full h-8" preload="none">
                                        <source src={call.recording_url} />
                                    </audio>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}