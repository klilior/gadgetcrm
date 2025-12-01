import React, { useState, useEffect } from 'react';
import { Client } from '@/entities/all';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CreditCard, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function PaymentModal({ isOpen, onClose }) {
    const [clients, setClients] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorDetails, setErrorDetails] = useState(null);
    const [iframeUrl, setIframeUrl] = useState('');
    const [showIframe, setShowIframe] = useState(false);
    
    const [amount, setAmount] = useState('');
    const [itemName, setItemName] = useState('');
    const [customerId, setCustomerId] = useState('');
    const [orderId, setOrderId] = useState('');
    const [installments, setInstallments] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (isOpen) {
            loadClients();
            setShowIframe(false);
            setIframeUrl('');
        }

        // Listen for payment completion messages from iframe
        const handleMessage = (event) => {
            if (event.data && event.data.type === 'PAYMENT_COMPLETE') {
                if (event.data.success) {
                    toast.success('התשלום בוצע בהצלחה!');
                    handleCloseIframe();
                } else {
                    toast.error('התשלום נכשל או בוטל');
                    // Optionally keep iframe open or close it
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [isOpen]);

    const loadClients = async () => {
        setIsLoading(true);
        try {
            const clientsList = await Client.list('-updated_date', 100);
            setClients(clientsList);
        } catch (error) {
            console.error('Error loading clients:', error);
            toast.error('שגיאה בטעינת לקוחות');
        } finally {
            setIsLoading(false);
        }
    };

    const filteredClients = clients.filter(c => 
        !searchTerm || 
        (c.full_name && c.full_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (c.phone && c.phone.includes(searchTerm))
    );

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        console.log('🔵 [PaymentModal] Starting payment submission...');
        
        if (!amount || parseFloat(amount) <= 0) {
            toast.error('נא להזין סכום תקין');
            return;
        }
        
        if (!itemName.trim()) {
            toast.error('נא להזין שם פריט');
            return;
        }

        setIsProcessing(true);
        setErrorDetails(null);

        try {
            console.log('📤 [PaymentModal] Invoking createPaymentSession...');
            console.log('   Amount:', amount);
            console.log('   Item:', itemName);
            console.log('   Customer:', customerId);
            console.log('   Installments:', installments);

            const { data } = await base44.functions.invoke('createPaymentSession', {
                orderId: orderId || null,
                customerId: customerId || null,
                amount: parseFloat(amount),
                description: itemName,
                installments: parseInt(installments)
            });

            console.log('📥 [PaymentModal] Response:', data);

            if (data.success && data.paymentUrl) {
                toast.success('מפנה לדף תשלום...', {
                    icon: <CheckCircle className="w-4 h-4" />
                });
                
                console.log('✅ [PaymentModal] Payment URL:', data.paymentUrl);
                
                // הצג iframe במקום לפתוח חלון חדש
                setIframeUrl(data.paymentUrl);
                setShowIframe(true);
                
            } else {
                console.error('❌ [PaymentModal] Payment failed:', data.error);
                setErrorDetails({
                    message: data.error || 'שגיאה ביצירת תשלום',
                    details: JSON.stringify(data, null, 2)
                });
                toast.error(data.error || 'שגיאה ביצירת תשלום', {
                    icon: <AlertCircle className="w-4 h-4" />
                });
            }
        } catch (error) {
            console.error('❌ [PaymentModal] Exception:', error);
            
            let errorMessage = 'שגיאה ביצירת תשלום';
            let errorInfo = error.message;
            
            if (error.response) {
                errorInfo = JSON.stringify(error.response.data, null, 2);
                errorMessage = error.response.data?.error || errorMessage;
            }
            
            setErrorDetails({
                message: errorMessage,
                details: errorInfo
            });
            
            toast.error(errorMessage);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCloseIframe = () => {
        setShowIframe(false);
        setIframeUrl('');
        // נקה טופס
        setAmount('');
        setItemName('');
        setCustomerId('');
        setOrderId('');
        setInstallments(1);
        setSearchTerm('');
        onClose();
    };

    if (!isOpen) return null;

    if (showIframe) {
        return (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" dir="rtl">
                <div className="bg-white w-full h-full md:max-w-5xl md:h-[90vh] md:rounded-3xl flex flex-col shadow-2xl">
                    <div className="flex justify-between items-center p-4 border-b bg-gradient-to-r from-green-600 to-emerald-600">
                        <div className="flex items-center gap-3">
                            <CreditCard className="w-6 h-6 text-white" />
                            <div>
                                <h2 className="text-xl font-bold text-white">עמוד תשלום מאובטח</h2>
                                <p className="text-xs text-green-50">Z-Credit Payment Gateway</p>
                            </div>
                        </div>
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={handleCloseIframe}
                            className="text-white hover:bg-white/20"
                        >
                            <X className="w-6 h-6" />
                        </Button>
                    </div>
                    
                    <div className="flex-1 overflow-hidden bg-gray-50">
                        <iframe
                            src={iframeUrl}
                            className="w-full h-full border-0"
                            title="דף תשלום"
                            sandbox="allow-forms allow-scripts allow-same-origin allow-top-navigation"
                        />
                    </div>

                    <div className="p-4 border-t bg-white text-center">
                        <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                <span>חיבור מאובטח</span>
                            </div>
                            <span>•</span>
                            <span>תשלום מוגן ב-SSL</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
            <div className="glass-card w-full max-w-2xl p-6 rounded-3xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                        <CreditCard className="w-6 h-6 text-green-600" />
                        <h2 className="text-2xl font-bold text-gray-900">תשלום חדש</h2>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} disabled={isProcessing}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>

                {errorDetails && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="font-semibold text-red-900">{errorDetails.message}</p>
                                <details className="mt-2">
                                    <summary className="text-sm text-red-700 cursor-pointer hover:underline">
                                        פרטים טכניים
                                    </summary>
                                    <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-x-auto">
                                        {errorDetails.details}
                                    </pre>
                                </details>
                            </div>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* סכום */}
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-4 rounded-xl border-2 border-green-200">
                        <Label className="text-base font-semibold text-green-900 flex items-center gap-2">
                            💰 סכום לתשלום (₪) *
                        </Label>
                        <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="mt-2 text-2xl font-bold text-center border-2 border-green-300 focus:border-green-500"
                            required
                            disabled={isProcessing}
                        />
                    </div>

                    {/* שם פריט */}
                    <div>
                        <Label className="text-base font-semibold">📦 שם הפריט / תיאור *</Label>
                        <Input
                            type="text"
                            value={itemName}
                            onChange={(e) => setItemName(e.target.value)}
                            placeholder="לדוגמה: iPhone 13 Pro"
                            className="glass-button mt-2"
                            required
                            disabled={isProcessing}
                        />
                    </div>

                    {/* תשלומים */}
                    <div>
                        <Label className="text-base font-semibold">🔢 מספר תשלומים</Label>
                        <Select 
                            value={installments.toString()} 
                            onValueChange={(val) => setInstallments(parseInt(val))}
                            disabled={isProcessing}
                        >
                            <SelectTrigger className="glass-button mt-2">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">תשלום אחד</SelectItem>
                                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(num => (
                                    <SelectItem key={num} value={num.toString()}>
                                        {num} תשלומים
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <hr className="border-gray-300" />

                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                        <p className="text-sm text-blue-900 font-medium">
                            💡 השדות הבאים אופציונליים - לקישור הזמנה או לקוח קיים
                        </p>
                    </div>

                    {/* לקוח */}
                    <div>
                        <Label className="text-base font-semibold">👤 לקוח (אופציונלי)</Label>
                        <Input
                            type="text"
                            placeholder="חיפוש לקוח..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="glass-button mt-2 mb-2"
                            disabled={isProcessing}
                        />
                        {isLoading ? (
                            <div className="text-center py-4">
                                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                            </div>
                        ) : (
                            <Select value={customerId} onValueChange={setCustomerId} disabled={isProcessing}>
                                <SelectTrigger className="glass-button">
                                    <SelectValue placeholder="בחר לקוח (לא חובה)" />
                                </SelectTrigger>
                                <SelectContent className="max-h-60">
                                    <SelectItem value={null}>ללא לקוח</SelectItem>
                                    {filteredClients.map(client => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.full_name} {client.phone && `- ${client.phone}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* מספר הזמנה */}
                    <div>
                        <Label className="text-base font-semibold">📋 מספר הזמנה (אופציונלי)</Label>
                        <Input
                            type="text"
                            value={orderId}
                            onChange={(e) => setOrderId(e.target.value)}
                            placeholder="לדוגמה: 12345"
                            className="glass-button mt-2"
                            disabled={isProcessing}
                        />
                    </div>

                    {/* כפתורים */}
                    <div className="flex gap-3 justify-end pt-4">
                        <Button 
                            type="button" 
                            variant="outline" 
                            onClick={onClose}
                            disabled={isProcessing}
                            size="lg"
                        >
                            ביטול
                        </Button>
                        <Button 
                            type="submit" 
                            className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg"
                            disabled={isProcessing}
                            size="lg"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin ml-2" />
                                    מכין דף תשלום...
                                </>
                            ) : (
                                <>
                                    <CreditCard className="w-5 h-5 ml-2" />
                                    פתח דף תשלום
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}