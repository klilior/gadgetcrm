import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Phone, Mail, Edit, AlertTriangle } from "lucide-react";
import { Button } from '@/components/ui/button';

export default function CustomerInfoCard({ customer, onEdit }) {
    if (!customer) {
        return (
            <Card className="glass-card border-0 mb-3 sm:mb-6" style={{ background: 'rgba(235, 245, 255, 0.5)', backdropFilter: 'blur(10px)'}}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-sm sm:text-base justify-center sm:justify-start text-blue-800">
                        <User className="w-4 h-4 sm:w-5 sm:h-5" />
                        פרטי לקוח
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-gray-500">אין מידע על לקוח</p>
                </CardContent>
            </Card>
        );
    }

    // Check if this is extracted data (not from Customer entity)
    const isExtractedData = customer.id === 'unknown' || !customer.id;

    return (
        <Card className="glass-card border-0 mb-3 sm:mb-6" style={{ background: 'rgba(235, 245, 255, 0.5)', backdropFilter: 'blur(10px)'}}>
            <CardHeader className="px-3 sm:px-6 py-3 sm:py-4 flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-3 text-sm sm:text-base text-blue-800">
                    <User className="w-4 h-4 sm:w-5 sm:h-5" />
                    פרטי לקוח
                </CardTitle>
                {onEdit && !isExtractedData && (
                    <Button variant="ghost" size="sm" onClick={() => onEdit(customer)} className="text-blue-700 hover:bg-blue-100">
                        <Edit className="w-4 h-4 ml-2" />
                        ערוך
                    </Button>
                )}
            </CardHeader>
            <CardContent className="px-3 sm:px-6 space-y-3 text-sm">
                {isExtractedData && (
                    <div className="flex items-center gap-2 p-2 bg-yellow-50 rounded-lg border border-yellow-200">
                        <AlertTriangle className="w-4 h-4 text-yellow-600" />
                        <span className="text-xs text-yellow-800">נתונים מופקים מתוכן הטיקט</span>
                    </div>
                )}
                
                <div className="font-bold text-base text-gray-800">
                    {customer.full_name || 'לקוח לא ידוע'}
                </div>
                
                {customer.phone && (
                    <a href={`tel:${customer.phone}`} className="flex items-center gap-3 text-blue-700 hover:underline">
                        <Phone className="w-4 h-4"/>
                        <span>{customer.phone}</span>
                    </a>
                )}
                
                {customer.email && (
                    <a href={`mailto:${customer.email}`} className="flex items-center gap-3 text-blue-700 hover:underline break-all">
                        <Mail className="w-4 h-4"/>
                        <span>{customer.email}</span>
                    </a>
                )}
                
                {!customer.phone && !customer.email && (
                    <p className="text-xs text-gray-500">אין פרטי יצירת קשר זמינים</p>
                )}
            </CardContent>
        </Card>
    );
}