import React, { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { Settings as SettingsEntity } from '@/entities/all';

export default function RepairReceipt({ repair, client, device, agent, isOpen, onClose }) {
    const printRef = useRef();
    const [termsText, setTermsText] = useState('');

    useEffect(() => {
        if (isOpen) {
            loadTerms();
        }
    }, [isOpen]);

    const loadTerms = async () => {
        try {
            const settings = await SettingsEntity.filter({ setting_name: 'REPAIR_RECEIPT_TERMS' });
            if (settings.length > 0 && settings[0].setting_value) {
                setTermsText(settings[0].setting_value);
            } else {
                // Default terms
                setTermsText(`• אני מאשר/ת כי קיבלתי הסבר מפורט על התקלה והתיקון הנדרש
• המכשיר נמסר למעבדה לצורך תיקון בלבד, והמעבדה אינה אחראית לתכנים במכשיר
• מחיר התיקון הסופי עשוי להשתנות בהתאם לממצאי האבחון
• המעבדה תעדכן אותי בכל שינוי במחיר או בזמן הטיפול
• במידה והמכשיר לא ייאסף תוך 30 יום מההודעה על סיום התיקון, המעבדה רשאית לגבות דמי אחסון`);
            }
        } catch (error) {
            console.log("Failed to load terms, using defaults");
            setTermsText(`• אני מאשר/ת כי קיבלתי הסבר מפורט על התקלה והתיקון הנדרש
• המכשיר נמסר למעבדה לצורך תיקון בלבד, והמעבדה אינה אחראית לתכנים במכשיר
• מחיר התיקון הסופי עשוי להשתנות בהתאם לממצאי האבחון`);
        }
    };

    const handlePrint = () => {
        const printContent = printRef.current;
        const windowPrint = window.open('', '', 'width=800,height=600');
        
        windowPrint.document.write(`
            <html>
                <head>
                    <title>אישור קבלה - ${repair.repair_id}</title>
                    <style>
                        @media print {
                            @page { 
                                size: A4;
                                margin: 1cm;
                            }
                            body { margin: 0; }
                            .no-print { display: none; }
                        }
                        body {
                            font-family: Arial, sans-serif;
                            direction: rtl;
                            text-align: right;
                            background: white;
                        }
                        .receipt-container {
                            max-width: 19cm;
                            margin: 0 auto;
                            background: white;
                        }
                        .header {
                            text-align: center;
                            margin-bottom: 15px;
                            border-bottom: 2px solid #7D0F82;
                            padding-bottom: 10px;
                        }
                        .logo {
                            max-width: 150px;
                            height: auto;
                            margin: 0 auto 8px;
                        }
                        .title {
                            font-size: 20px;
                            font-weight: bold;
                            color: #7D0F82;
                            margin: 5px 0;
                        }
                        .repair-number {
                            font-size: 16px;
                            color: #333;
                            margin: 5px 0;
                        }
                        .section {
                            margin: 12px 0;
                            padding: 10px;
                            background: #f9f9f9;
                            border-radius: 5px;
                        }
                        .section-title {
                            font-size: 14px;
                            font-weight: bold;
                            color: #7D0F82;
                            margin-bottom: 8px;
                            border-bottom: 1px solid #7D0F82;
                            padding-bottom: 3px;
                        }
                        .info-row {
                            display: flex;
                            margin: 5px 0;
                            font-size: 11px;
                        }
                        .info-label {
                            font-weight: bold;
                            min-width: 100px;
                            color: #555;
                        }
                        .info-value {
                            flex: 1;
                            color: #000;
                        }
                        .terms {
                            margin: 15px 0;
                            padding: 12px;
                            background: #fff3cd;
                            border: 1px solid #ffc107;
                            border-radius: 5px;
                        }
                        .terms-title {
                            font-size: 13px;
                            font-weight: bold;
                            color: #856404;
                            margin-bottom: 6px;
                        }
                        .terms-content {
                            font-size: 10px;
                            color: #856404;
                            white-space: pre-wrap;
                            line-height: 1.6;
                        }
                        .signature-section {
                            margin-top: 20px;
                            display: flex;
                            justify-content: space-between;
                            padding-top: 10px;
                        }
                        .signature-box {
                            width: 45%;
                            text-align: center;
                        }
                        .signature-line {
                            border-top: 1px solid #000;
                            margin-top: 40px;
                            padding-top: 8px;
                            font-size: 11px;
                            color: #555;
                        }
                        .footer {
                            margin-top: 15px;
                            text-align: center;
                            font-size: 9px;
                            color: #888;
                            border-top: 1px solid #ddd;
                            padding-top: 8px;
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

    const formatDateTime = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('he-IL') + ' ' + date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-auto" dir="rtl">
            <div className="bg-white rounded-3xl p-6 max-w-4xl w-full my-8">
                <div className="flex justify-between items-center mb-6 no-print">
                    <h2 className="text-2xl font-bold text-gray-900">אישור קבלה לתיקון</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>

                {/* Receipt Content */}
                <div ref={printRef} className="bg-white">
                    <div className="receipt-container">
                        {/* Header */}
                        <div className="header">
                            <img 
                                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ae063720d0fdd0f652ee26/9fc743b6c_logo-2-1.png" 
                                alt="Gadget Team Logo" 
                                className="logo"
                            />
                            <div className="title">אישור קבלה לתיקון במעבדה</div>
                            <div className="repair-number">מספר תיקון: {repair.repair_id}</div>
                            <div style={{ fontSize: '11px', color: '#666' }}>
                                תאריך קבלה: {formatDateTime(repair.created_date)}
                            </div>
                        </div>

                        {/* Customer & Device Info - Combined */}
                        <div className="section">
                            <div className="section-title">פרטי לקוח ומכשיר</div>
                            <div className="info-row">
                                <div className="info-label">לקוח:</div>
                                <div className="info-value">{client?.full_name || 'לא ידוע'} • {client?.phone || 'לא ידוע'}</div>
                            </div>
                            <div className="info-row">
                                <div className="info-label">מכשיר:</div>
                                <div className="info-value">
                                    {device ? `${device.manufacturer} ${device.model} (${device.color})` : 'לא ידוע'}
                                </div>
                            </div>
                            <div className="info-row">
                                <div className="info-label">IMEI/סידורי:</div>
                                <div className="info-value">{device?.serial_imei || 'לא צוין'}</div>
                            </div>
                            <div className="info-row">
                                <div className="info-label">קוד נעילה:</div>
                                <div className="info-value">{repair.lock_code || 'לא צוין'}</div>
                            </div>
                        </div>

                        {/* Repair Info */}
                        <div className="section">
                            <div className="section-title">פרטי התקלה</div>
                            <div className="info-row">
                                <div className="info-label">תקלה:</div>
                                <div className="info-value">{repair.issue_category} - {repair.issue_description}</div>
                            </div>
                            {repair.existing_damage && (
                                <div className="info-row">
                                    <div className="info-label">נזק קיים:</div>
                                    <div className="info-value">{repair.existing_damage}</div>
                                </div>
                            )}
                            <div className="info-row">
                                <div className="info-label">סוג תיקון:</div>
                                <div className="info-value">{repair.repair_type}</div>
                            </div>
                            {repair.repair_type === 'מעבדת יבואן' && (
                                <div style={{ background: '#FFF3CD', border: '2px solid #FFC107', padding: '10px', marginTop: '8px', borderRadius: '5px' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#856404', marginBottom: '4px' }}>⏳ לוחות זמנים — טיפול יבואן:</div>
                                    <div style={{ fontSize: '11px', color: '#856404', lineHeight: '1.6' }}>
                                        המכשיר נמסר לטיפול אצל היבואן. הטיפול צפוי להימשך עד 21 ימי עסקים מיום הקבלה.
                                        <br/>במקרים חריגים ובהודעה מוקדמת מראש, ייתכן שהתהליך יימשך עד 30 ימי עסקים.
                                    </div>
                                </div>
                            )}
                            {repair.expected_price > 0 && (
                                <div className="info-row">
                                    <div className="info-label">מחיר משוער:</div>
                                    <div className="info-value">₪{repair.expected_price}</div>
                                </div>
                            )}
                        </div>

                        {/* Terms and Conditions */}
                        <div className="terms">
                            <div className="terms-title">תנאים והתחייבויות:</div>
                            <div className="terms-content">{termsText}</div>
                        </div>

                        {/* Signature */}
                        <div className="signature-section">
                            <div className="signature-box">
                                <div className="signature-line">
                                    חתימת הלקוח
                                </div>
                            </div>
                            <div className="signature-box">
                                <div className="signature-line">
                                    נציג: {agent?.employee_name || 'לא ידוע'}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="footer">
                            <div>Gadget-Team - מעבדת תיקונים מקצועית</div>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 mt-6 no-print">
                    <Button variant="outline" onClick={onClose}>
                        סגור
                    </Button>
                    <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Printer className="w-4 h-4 ml-2" />
                        הדפס אישור
                    </Button>
                </div>
            </div>
        </div>
    );
}