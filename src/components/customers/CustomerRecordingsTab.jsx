import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Phone, PhoneIncoming, PhoneOutgoing, ExternalLink, Play, Download } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

function isDriveUrl(url) {
    return url?.includes('drive.google.com');
}

function getDirectDriveUrl(url) {
    // Convert drive.google.com/file/d/FILE_ID/view → direct download link
    const match = url?.match(/\/file\/d\/([^/]+)/);
    if (match) {
        return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
    return url;
}

function RecordingPlayer({ url }) {
    if (!url) return null;

    if (isDriveUrl(url)) {
        const directUrl = getDirectDriveUrl(url);
        return (
            <div className="flex items-center gap-2">
                <audio controls className="flex-1 h-8" preload="none">
                    <source src={directUrl} />
                </audio>
                <a href={url} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="פתח ב-Drive">
                        <ExternalLink className="w-4 h-4 text-blue-600" />
                    </Button>
                </a>
            </div>
        );
    }

    return (
        <audio controls className="w-full h-8" preload="none">
            <source src={url} />
        </audio>
    );
}

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
                                {isDriveUrl(call.recording_url) && (
                                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Drive</span>
                                )}
                            </div>
                            <span className="text-xs text-gray-500">
                                {call.created_date ? format(new Date(call.created_date), 'dd/MM/yyyy HH:mm', { locale: he }) : ''}
                            </span>
                        </div>
                        <p className="text-xs text-gray-600">{call.content?.substring(0, 120)}</p>
                        <RecordingPlayer url={call.recording_url} />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}