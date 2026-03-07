import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wrench } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

const REPAIR_STATUS_COLORS = {
    'בטיפול/אבחון': 'bg-blue-100 text-blue-800',
    'בטיפול החנות': 'bg-blue-100 text-blue-800',
    'הוזמן חלק': 'bg-yellow-100 text-yellow-800',
    'מכשיר סיים תיקון וממתין לאיסוף': 'bg-green-100 text-green-800',
    'לא ניתן לתיקון': 'bg-red-100 text-red-800',
    'תיקון נסגר': 'bg-gray-100 text-gray-700',
    'At_Importer': 'bg-purple-100 text-purple-800',
    'Back_From_Importer': 'bg-indigo-100 text-indigo-800',
};

function formatDate(dateString) {
    if (!dateString) return 'אין מידע';
    try {
        return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: he });
    } catch {
        return 'תאריך לא תקין';
    }
}

export default function CustomerRepairsTab({ repairs }) {
    if (!repairs || repairs.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Wrench className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין תיקונים ללקוח זה</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {repairs.map(repair => (
                <Card key={repair.id} className="hover:shadow-lg transition-shadow">
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <Wrench className="w-4 h-4 text-orange-500" />
                                    <p className="font-semibold text-lg">תיקון #{repair.repair_id}</p>
                                </div>
                                <p className="text-gray-700 mt-1">{repair.issue_category} - {repair.issue_description}</p>
                                {repair.repair_type && (
                                    <p className="text-xs text-gray-500 mt-1">סוג: {repair.repair_type}</p>
                                )}
                                <p className="text-sm text-gray-500 mt-2">{formatDate(repair.created_date)}</p>
                                {repair.sla_due && (
                                    <p className="text-xs text-gray-500 mt-1">SLA: {repair.sla_due}</p>
                                )}
                            </div>
                            <div className="text-left space-y-1">
                                <Badge className={REPAIR_STATUS_COLORS[repair.status] || 'bg-gray-100 text-gray-700'}>
                                    {repair.status}
                                </Badge>
                                {repair.expected_price > 0 && (
                                    <p className="text-sm text-gray-600">צפוי: ₪{repair.expected_price}</p>
                                )}
                                {repair.final_price > 0 && (
                                    <p className="text-lg font-bold text-green-600">₪{repair.final_price}</p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}