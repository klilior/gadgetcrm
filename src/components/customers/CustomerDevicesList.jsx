import React, { useState, useEffect } from 'react';
import { RepairDevice } from '@/entities/all';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Smartphone, Calendar, FileText, Hash } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

const ACCESSORY_KEYWORDS = ['כיסוי', 'מגן מסך', 'מטען', 'כבל', 'אוזניות', 'ספר', 'חוברת', 'נרתיק', 'סוללה', 'מתאם', 'עגינה', 'מעמד', 'חצובה', 'רצועה', 'פילם', 'סטנד', 'תחנת', 'עט', 'מקלדת', 'עכבר', 'מארז', 'תיק', 'ניקוי', 'אביזר'];

function isAccessory(device) {
    if (device.manufacturer === 'אביזר כללי') return true;
    const model = (device.model || '').toLowerCase();
    return ACCESSORY_KEYWORDS.some(kw => model.includes(kw));
}

export default function CustomerDevicesList({ customerId }) {
    const [devices, setDevices] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!customerId) return;
        loadDevices();
    }, [customerId]);

    const loadDevices = async () => {
        setIsLoading(true);
        try {
            const deviceList = await RepairDevice.filter({ client_id: customerId }, '-created_date');
            const filtered = (deviceList || []).filter(d => !isAccessory(d));
            setDevices(filtered);
        } catch (err) {
            console.error('Error loading devices:', err);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return <div className="text-center py-10 text-gray-500">טוען מכשירים...</div>;
    }

    if (devices.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                <Smartphone className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>אין מכשירים רשומים ללקוח זה</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {devices.map(device => (
                <Card key={device.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                        <div className="flex justify-between items-start">
                            <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                                    <Smartphone className="w-5 h-5 text-indigo-600" />
                                </div>
                                <div>
                                    <p className="font-semibold text-base">
                                        {device.manufacturer} {device.model}
                                    </p>
                                    <div className="flex flex-wrap gap-2 mt-1.5">
                                        {device.serial_imei && !device.serial_imei.startsWith('PENDING') && (
                                            <Badge variant="outline" className="text-xs flex items-center gap-1">
                                                <Hash className="w-3 h-3" />
                                                {device.serial_imei}
                                            </Badge>
                                        )}
                                        {device.color && (
                                            <Badge variant="secondary" className="text-xs">
                                                {device.color}
                                            </Badge>
                                        )}
                                        {device.sku && (
                                            <Badge variant="secondary" className="text-xs">
                                                מק״ט: {device.sku}
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                                        {device.purchase_date && (
                                            <span className="flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                רכישה: {format(new Date(device.purchase_date), 'dd/MM/yyyy', { locale: he })}
                                            </span>
                                        )}
                                        {device.purchase_invoice_number && (
                                            <span className="flex items-center gap-1">
                                                <FileText className="w-3 h-3" />
                                                חשבונית: {device.purchase_invoice_number}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {device.source && (
                                <Badge variant="outline" className="text-[10px] text-gray-500">
                                    {device.source}
                                </Badge>
                            )}
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}