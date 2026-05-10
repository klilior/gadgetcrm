import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X, AlertTriangle } from 'lucide-react';

export default function RepairLabel({ repair, client, device, vendor, agent, isOpen, onClose }) {
    const printRef = useRef();

    const handlePrint = () => {
        const printContent = printRef.current;
        const windowPrint = window.open('', '', 'width=800,height=600');
        
        windowPrint.document.write(`
            <html>
                <head>
                    <title>מדבקת תיקון - ${repair.repair_id}</title>
                    <style>
                        @media print {
                            @page { margin: 0; }
                            body { margin: 1cm; }
                        }
                        body {
                            font-family: Arial, sans-serif;
                            direction: rtl;
                            text-align: right;
                        }
                        .label-container {
                            border: 2px solid #000;
                            padding: 15px;
                            width: 10cm;
                            margin: 0 auto;
                        }
                        .logo {
                            text-align: center;
                            margin-bottom: 15px;
                            font-size: 24px;
                            font-weight: bold;
                            color: #7D0F82;
                        }
                        .repair-number {
                            text-align: center;
                            font-size: 28px;
                            font-weight: bold;
                            margin-bottom: 10px;
                            background: #f0f0f0;
                            padding: 8px;
                            border-radius: 5px;
                        }
                        .quote-warning {
                            background: #FEE;
                            border: 3px solid #F00;
                            padding: 10px;
                            margin: 10px 0;
                            text-align: center;
                            font-weight: bold;
                            font-size: 16px;
                            color: #C00;
                        }
                        .info-row {
                            margin: 8px 0;
                            font-size: 14px;
                        }
                        .info-label {
                            font-weight: bold;
                            display: inline-block;
                            width: 80px;
                        }
                        .barcode-container {
                            text-align: center;
                            margin-top: 15px;
                        }
                        .barcode-container img {
                            max-width: 100%;
                            height: auto;
                        }
                        .agent-info {
                            text-align: center;
                            margin-top: 10px;
                            font-size: 12px;
                            color: #666;
                        }
                    </style>
                </head>
                <body>
                    ${printContent.innerHTML}
                </body>
            </html>
        `);
        
        windowPrint.document.close();
        windowPrint.focus();
        
        setTimeout(() => {
            windowPrint.print();
            windowPrint.close();
        }, 250);
    };

    if (!isOpen) return null;

    const getShortRepairId = (repairId) => {
        if (!repairId) return '';
        const idStr = String(repairId);
        const parts = idStr.split('-');
        if (parts.length >= 3) return parts[parts.length - 1];
        const match = idStr.match(/(\d{4})$/);
        return match ? match[1] : idStr.slice(-4);
    };

    const shortRepairId = getShortRepairId(repair.repair_id);
    const barcodeUrl = `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(shortRepairId)}&code=Code128&translate-esc=on`;

    const formatDateTime = (dateString) => {
        const date = new Date(dateString);
        const dateStr = date.toLocaleDateString('he-IL');
        const timeStr = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${dateStr} ${timeStr}`;
    };

    // Extract device info safely
    const deviceManufacturer = device?.manufacturer || 'לא צוין';
    const deviceModel = device?.model || 'לא צוין';
    const deviceColor = device?.color || 'לא צוין';
    
    // Extract agent info with multiple fallbacks
    const agentName = agent?.employee_name || agent?.full_name || agent?.email || repair?.created_by?.split('@')[0] || 'מערכת';

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
            <div className="bg-white rounded-3xl p-6 max-w-2xl w-full">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">הדפסת מדבקה</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>

                {/* Preview */}
                <div ref={printRef} className="border-2 border-gray-300 rounded-lg p-6 mb-6 bg-white">
                    <div className="label-container" style={{ maxWidth: '10cm', margin: '0 auto' }}>
                        <div className="logo">
                            GADGET-TEAM
                        </div>
                        

                        {repair.quote_required && (
                            <div className="quote-warning">
                                ⚠️ דרושה הצעת מחיר לפני תיקון! ⚠️<br/>
                                אין לתקן ללא אישור הלקוח!
                            </div>
                        )}
                        
                        <div className="info-row">
                            <span className="info-label">לקוח:</span>
                            <span>{client?.full_name || 'לא ידוע'}</span>
                        </div>
                        
                        <div className="info-row">
                            <span className="info-label">טלפון:</span>
                            <span>{client?.phone || 'לא ידוע'}</span>
                        </div>
                        
                        <div className="info-row">
                            <span className="info-label">מכשיר:</span>
                            <span>{deviceManufacturer} {deviceModel}</span>
                        </div>
                        
                        <div className="info-row">
                            <span className="info-label">צבע:</span>
                            <span>{deviceColor}</span>
                        </div>
                        
                        <div className="info-row">
                            <span className="info-label">מס' סידורי:</span>
                            <span>{device?.serial_imei || 'לא צוין'}</span>
                        </div>

                        <div className="info-row">
                            <span className="info-label">סוג תיקון:</span>
                            <span>
                                {repair.repair_type}
                                {repair.repair_type === 'מעבדת יבואן' && (vendor?.name ? ` - ${vendor.name}` : '')}
                            </span>
                        </div>

                        {repair.repair_type === 'מעבדת יבואן' && (
                            <div style={{ background: '#FFF3CD', border: '2px solid #FFC107', padding: '8px', margin: '10px 0', borderRadius: '5px', fontSize: '12px', color: '#856404', fontWeight: 'bold', textAlign: 'center' }}>
                                ⏳ טיפול יבואן — עד 21 ימי עסקים מיום הקבלה.
                                <br/>במקרים חריגים ובהודעה מוקדמת, עד 30 ימי עסקים.
                            </div>
                        )}
                        
                        <div className="info-row">
                            <span className="info-label">קוד נעילה:</span>
                            <span>{repair.lock_code || 'לא צוין'}</span>
                        </div>
                        
                        <div className="info-row">
                            <span className="info-label">תקלה:</span>
                            <span>{repair.issue_category}</span>
                        </div>
                        
                        {repair.issue_description && (
                            <div className="info-row">
                                <span className="info-label">פירוט:</span>
                                <span>{repair.issue_description}</span>
                            </div>
                        )}
                        
                        <div className="barcode-container">
                            <img 
                                src={barcodeUrl} 
                                alt={`Barcode: ${repair.repair_id}`}
                                style={{ maxWidth: '80%', height: 'auto' }}
                            />
                        </div>
                        
                        <div className="agent-info">
                            קליטה על ידי: {agentName}
                            {' | '}
                            {formatDateTime(repair.created_date)}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={onClose}>
                        סגור
                    </Button>
                    <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Printer className="w-4 h-4 ml-2" />
                        הדפס מדבקה
                    </Button>
                </div>
            </div>
        </div>
    );
}