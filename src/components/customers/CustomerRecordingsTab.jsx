import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

export default function CustomerRecordingsTab({ activities }) {
    const recordings = (activities || []).filter(a =>
        a.recording_url && (a.activity_type === 'שיחה נכנסת' || a.activity_type === 'שיחה יוצאת')
    );

    if (recordings.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Phone className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין הקלטות שיחות</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {recordings.map(call => (
                <Card key={call.id} className="hover:shadow-lg transition-shadow">
                    <CardContent className="p-4 space-y-2">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                {call.activity_type === 'שיחה נכנסת' ? (
                                    <PhoneIncoming className="w-4 h-4 text-green-500" />
                                ) : (
                                    <PhoneOutgoing className="w-4 h-4 text-blue-500" />
                                )}
                                <span className="font-medium text-sm">{call.activity_type}</span>
                            </div>
                            <span className="text-xs text-gray-500">
                                {call.created_date ? format(new Date(call.created_date), 'dd/MM/yyyy HH:mm', { locale: he }) : ''}
                            </span>
                        </div>
                        <p className="text-xs text-gray-600">{call.content?.substring(0, 120)}</p>
                        <audio controls className="w-full h-8" preload="none">
                            <source src={call.recording_url} />
                        </audio>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}