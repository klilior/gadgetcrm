import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

function formatDate(dateString) {
    if (!dateString) return 'אין מידע';
    try {
        return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: he });
    } catch {
        return 'תאריך לא תקין';
    }
}

export default function CustomerTicketsTab({ tickets }) {
    if (!tickets || tickets.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין פניות ללקוח זה</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {tickets.map(ticket => (
                <Card key={ticket.id} className="hover:shadow-lg transition-shadow">
                    <CardContent className="p-4">
                        <div className="space-y-3">
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <p className="font-semibold text-lg">טיקט #{ticket.ticket_number}</p>
                                        <Badge className={
                                            ticket.status === 'נסגר' ? 'bg-gray-200 text-gray-700' :
                                                ticket.status === 'חדש' ? 'bg-teal-100 text-teal-800' :
                                                    'bg-blue-100 text-blue-800'
                                        }>
                                            {ticket.status}
                                        </Badge>
                                    </div>
                                    <p className="text-gray-900 font-medium">{ticket.subject}</p>
                                    {ticket.description && (
                                        <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">
                                            {ticket.description.length > 200
                                                ? ticket.description.substring(0, 200) + '...'
                                                : ticket.description
                                            }
                                        </p>
                                    )}
                                    <div className="flex gap-4 mt-3 text-xs text-gray-500 flex-wrap">
                                        {ticket.inquiry_type && (
                                            <Badge variant="secondary" className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700">
                                                סוג פנייה: {ticket.inquiry_type}
                                            </Badge>
                                        )}
                                        {ticket.contact_channel && (
                                            <Badge variant="secondary" className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700">
                                                ערוץ: {ticket.contact_channel}
                                            </Badge>
                                        )}
                                        {ticket.priority && (
                                            <Badge variant="outline" className={`text-xs ${ticket.priority === 'גבוהה' ? 'bg-red-100 text-red-800' : ''}`}>
                                                {ticket.priority}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs text-gray-500 pt-2 border-t mt-3">
                                נוצר ב-{formatDate(ticket.created_date)}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}