import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    
    try {
        const payload = await req.json();
        console.log('Payment callback received:', payload);

        const { TransactionUniqueID, ZCreditReferenceNumber, IsSucceed, ReturnMessage } = payload;

        if (!TransactionUniqueID) {
            console.error('No TransactionUniqueID in callback');
            return new Response(JSON.stringify({ error: 'Missing TransactionUniqueID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // מצא את התשלום
        const payments = await base44.entities.Payment.filter({
            transaction_unique_id: TransactionUniqueID
        });

        if (payments.length === 0) {
            console.error(`Payment not found for TransactionUniqueID: ${TransactionUniqueID}`);
            return new Response(JSON.stringify({ error: 'Payment not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const payment = payments[0];

        // עדכן סטטוס
        const newStatus = IsSucceed ? 'approved' : 'failed';
        
        await base44.entities.Payment.update(payment.id, {
            status: newStatus,
            zcredit_reference_number: ZCreditReferenceNumber,
            return_message: ReturnMessage,
            raw_response: payload
        });

        // אם התשלום אושר - הפק חשבונית
        if (IsSucceed) {
            try {
                await fetch(`${Deno.env.get('APP_BASE_URL')}/functions/createLinetInvoice`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': req.headers.get('Authorization') || ''
                    },
                    body: JSON.stringify({ paymentId: payment.id })
                });
            } catch (invoiceError) {
                console.error('Failed to create invoice:', invoiceError);
                // לא נכשיל את התשלום בגלל חשבונית
            }
        }

        return new Response(JSON.stringify({
            success: true,
            paymentId: payment.id,
            status: newStatus
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Payment callback error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});