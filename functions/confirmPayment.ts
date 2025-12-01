import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me();
        if (!user || !['מנהל', 'נציג'].includes(user.role)) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { paymentId, authNum } = await req.json();

        if (!paymentId || !authNum) {
            return new Response(JSON.stringify({ error: 'Missing paymentId or authNum' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // טען תשלום
        const payment = await base44.asServiceRole.entities.Payment.get(paymentId);

        if (payment.status !== 'waiting_approval') {
            return new Response(JSON.stringify({ error: 'Payment not waiting for approval' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // טען הגדרות
        const settings = await base44.asServiceRole.entities.PaymentSettings.filter({
            setting_group: 'zcredit'
        });

        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.setting_key] = s.setting_value;
        });

        const mode = payment.mode_snapshot;
        const baseUrl = mode === 'live' 
            ? 'https://pci.zcredit.co.il/ZCreditWS/api/Transaction'
            : 'https://pcitest.zcredit.co.il/ZCreditWS/api/Transaction';

        // שלח שוב את אותה בקשה עם AuthNum
        const originalRequest = payment.raw_request;
        const confirmRequest = {
            ...originalRequest,
            AuthNum: authNum
        };

        const response = await fetch(`${baseUrl}/CommitFullTransaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(confirmRequest)
        });

        const result = await response.json();

        await base44.asServiceRole.entities.Payment.update(paymentId, {
            auth_num: authNum,
            raw_response: result
        });

        if (result.IsSucceed || result.ReturnCode === 0) {
            await base44.asServiceRole.entities.Payment.update(paymentId, {
                status: 'approved',
                zcredit_reference_number: result.ReferenceNumber
            });

            // הפק חשבונית
            try {
                await fetch(`${Deno.env.get('APP_BASE_URL')}/functions/createLinetInvoice`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': req.headers.get('Authorization') || ''
                    },
                    body: JSON.stringify({ paymentId })
                });
            } catch (invoiceError) {
                console.error('Failed to create invoice:', invoiceError);
            }

            return new Response(JSON.stringify({
                success: true,
                paymentId,
                referenceNumber: result.ReferenceNumber
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            await base44.asServiceRole.entities.Payment.update(paymentId, {
                status: 'failed',
                return_message: result.ReturnMessage
            });

            return new Response(JSON.stringify({
                success: false,
                error: result.ReturnMessage || 'Payment confirmation failed'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

    } catch (error) {
        console.error('Confirm payment error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});