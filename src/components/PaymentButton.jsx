import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CreditCard, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function PaymentButton({ orderId, customerId, amount, mode = 'webcheckout', onSuccess, onError }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentUrl, setPaymentUrl] = useState(null);
    const [error, setError] = useState(null);
    const [needsApproval, setNeedsApproval] = useState(false);
    const [paymentId, setPaymentId] = useState(null);
    const [authNum, setAuthNum] = useState('');

    // Gateway mode fields
    const [cardNumber, setCardNumber] = useState('');
    const [cvv, setCvv] = useState('');
    const [expMonth, setExpMonth] = useState('');
    const [expYear, setExpYear] = useState('');
    const [installments, setInstallments] = useState(1);

    const handleWebCheckout = async () => {
        setIsProcessing(true);
        setError(null);

        try {
            const { data } = await base44.functions.invoke('createPaymentSession', {
                orderId,
                customerId,
                amount,
                installments: parseInt(installments)
            });

            if (data.success) {
                setPaymentUrl(data.paymentUrl);
            } else {
                setError(data.error || 'Failed to create payment session');
            }
        } catch (err) {
            setError(err.message);
            if (onError) onError(err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleGatewayCharge = async () => {
        setIsProcessing(true);
        setError(null);

        try {
            const { data } = await base44.functions.invoke('chargePayment', {
                orderId,
                customerId,
                amount,
                cardNumber,
                cvv,
                expMonth,
                expYear,
                installments: parseInt(installments)
            });

            if (data.success) {
                setIsOpen(false);
                if (onSuccess) onSuccess(data);
            } else if (data.needsApproval) {
                setNeedsApproval(true);
                setPaymentId(data.paymentId);
            } else {
                setError(data.error || 'Payment failed');
            }
        } catch (err) {
            setError(err.message);
            if (onError) onError(err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleConfirmPayment = async () => {
        setIsProcessing(true);
        setError(null);

        try {
            const { data } = await base44.functions.invoke('confirmPayment', {
                paymentId,
                authNum
            });

            if (data.success) {
                setIsOpen(false);
                setNeedsApproval(false);
                if (onSuccess) onSuccess(data);
            } else {
                setError(data.error || 'Confirmation failed');
            }
        } catch (err) {
            setError(err.message);
            if (onError) onError(err);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <>
            <Button onClick={() => setIsOpen(true)} className="bg-green-600 hover:bg-green-700">
                <CreditCard className="w-4 h-4 ml-2" />
                תשלום ₪{amount}
            </Button>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="sm:max-w-md" dir="rtl">
                    <DialogHeader>
                        <DialogTitle>תשלום - ₪{amount}</DialogTitle>
                    </DialogHeader>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                            <XCircle className="w-5 h-5" />
                            {error}
                        </div>
                    )}

                    {paymentUrl ? (
                        <div className="space-y-4">
                            <p className="text-sm text-gray-600">נא להשלים את התשלום בחלון הבא:</p>
                            <iframe 
                                src={paymentUrl} 
                                className="w-full h-96 border rounded-lg"
                                title="Payment"
                            />
                        </div>
                    ) : needsApproval ? (
                        <div className="space-y-4">
                            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
                                <p className="font-medium">נדרש אישור טלפוני</p>
                                <p className="text-sm">נא להזין את קוד האישור שהתקבל מהלקוח</p>
                            </div>
                            <div>
                                <Label>קוד אישור</Label>
                                <Input
                                    value={authNum}
                                    onChange={(e) => setAuthNum(e.target.value)}
                                    placeholder="הקלד קוד אישור"
                                    maxLength={6}
                                />
                            </div>
                            <Button 
                                onClick={handleConfirmPayment} 
                                disabled={isProcessing || !authNum}
                                className="w-full"
                            >
                                {isProcessing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <CheckCircle className="w-4 h-4 ml-2" />}
                                אשר תשלום
                            </Button>
                        </div>
                    ) : mode === 'webcheckout' ? (
                        <div className="space-y-4">
                            <div>
                                <Label>מספר תשלומים</Label>
                                <Input
                                    type="number"
                                    value={installments}
                                    onChange={(e) => setInstallments(e.target.value)}
                                    min={1}
                                    max={12}
                                />
                            </div>
                            <Button 
                                onClick={handleWebCheckout} 
                                disabled={isProcessing}
                                className="w-full"
                            >
                                {isProcessing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <CreditCard className="w-4 h-4 ml-2" />}
                                המשך לתשלום מאובטח
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <Label>מספר כרטיס</Label>
                                <Input
                                    value={cardNumber}
                                    onChange={(e) => setCardNumber(e.target.value)}
                                    placeholder="0000-0000-0000-0000"
                                    maxLength={19}
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <Label>CVV</Label>
                                    <Input
                                        value={cvv}
                                        onChange={(e) => setCvv(e.target.value)}
                                        placeholder="123"
                                        maxLength={3}
                                    />
                                </div>
                                <div>
                                    <Label>חודש</Label>
                                    <Input
                                        value={expMonth}
                                        onChange={(e) => setExpMonth(e.target.value)}
                                        placeholder="MM"
                                        maxLength={2}
                                    />
                                </div>
                                <div>
                                    <Label>שנה</Label>
                                    <Input
                                        value={expYear}
                                        onChange={(e) => setExpYear(e.target.value)}
                                        placeholder="YY"
                                        maxLength={2}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>מספר תשלומים</Label>
                                <Input
                                    type="number"
                                    value={installments}
                                    onChange={(e) => setInstallments(e.target.value)}
                                    min={1}
                                    max={12}
                                />
                            </div>
                            <Button 
                                onClick={handleGatewayCharge} 
                                disabled={isProcessing}
                                className="w-full bg-green-600 hover:bg-green-700"
                            >
                                {isProcessing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <CreditCard className="w-4 h-4 ml-2" />}
                                חייב
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}