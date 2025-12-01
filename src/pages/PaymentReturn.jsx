import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaymentReturn() {
    const [status, setStatus] = useState('processing');

    useEffect(() => {
        // Parse query params to check status if needed
        const params = new URLSearchParams(window.location.search);
        const success = params.get('success') !== 'false'; // Basic check, adjust based on Z-Credit params
        
        // Z-Credit might send parameters like 'ReferenceNumber', 'RetCode', etc.
        // Assuming success if we reached here for now, or verify params.

        if (success) {
            setStatus('success');
            // Notify parent window
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'PAYMENT_COMPLETE', success: true }, '*');
            }
        } else {
            setStatus('error');
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'PAYMENT_COMPLETE', success: false }, '*');
            }
        }
    }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4" dir="rtl">
            {status === 'success' ? (
                <div className="text-center space-y-4">
                    <div className="flex justify-center">
                        <CheckCircle className="w-16 h-16 text-green-500 animate-bounce" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">התשלום בוצע בהצלחה!</h1>
                    <p className="text-gray-600">ניתן לסגור את החלון כעת.</p>
                </div>
            ) : (
                <div className="text-center space-y-4">
                    <div className="flex justify-center">
                        <XCircle className="w-16 h-16 text-red-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">התשלום נכשל</h1>
                    <p className="text-gray-600">אנא נסה שנית או צור קשר עם התמיכה.</p>
                </div>
            )}
        </div>
    );
}