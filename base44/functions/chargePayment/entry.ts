import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { v4 as uuidv4 } from 'npm:uuid@9.0.0';

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

        const { orderId, customerId, amount, cardNumber, cvv, expMonth, expYear, installments } = await req.json();

        // טען הגדרות
        const settings = await base44.asServiceRole.entities.PaymentSettings.filter({
            setting_group: 'zcredit'
        });

        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.setting_key] = s.setting_value;
        });

        const mode = settingsMap['zcredit_mode'] || 'sandbox';
        const terminal = settingsMap['zcredit_terminal'];
        const password = settingsMap['zcredit_password'];

        if (!terminal || !password) {
            return new Response(JSON.stringify({ error: 'Z-Credit not configured' }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const transactionUniqueId = uuidv4();

        // יצירת רשומה
        const payment = await base44.asServiceRole.entities.Payment.create({
            order_id: orderId,
            customer_id: customerId,
            amount,
            currency: 'ILS',
            flow: 'gateway',
            transaction_unique_id: transactionUniqueId,
            status: 'pending',
            mode_snapshot: mode,
            installments: installments || 1
        });

        const zcreditRequest = {
            TerminalNumber: terminal,
            Password: password,
            TransactionSum: amount,
            CardNumber: cardNumber,
            CVV: cvv,
            ExpDate_MMYY: `${expMonth}${expYear}`,
            J: 0,
            CreditType: installments && installments > 1 ? 8 : 1,
            NumOfPayments: installments || 1,
            TransactionUniqueID: transactionUniqueId
        };

        await base44.asServiceRole.entities.Payment.update(payment.id, {
            raw_request: zcreditRequest
        });

        const baseUrl = mode === 'live' 
            ? 'https://pci.zcredit.co.il/ZCreditWS/api/Transaction'
            : 'https://pcitest.zcredit.co.il/ZCreditWS/api/Transaction';

        const response = await fetch(`${baseUrl}/CommitFullTransaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(zcreditRequest)
        });

        const result = await response.json();

        await base44.asServiceRole.entities.Payment.update(payment.id, {
            raw_response: result,
            zcredit_reference_number: result.ReferenceNumber
        });

        // בדוק אם נדרש אישור טלפוני
        if (result.IsTelApprovalNeeded) {
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                status: 'waiting_approval',
                is_tel_approval_needed: true,
                return_message: result.ReturnMessage
            });

            return new Response(JSON.stringify({
                success: false,
                needsApproval: true,
                message: result.ReturnMessage,
                paymentId: payment.id
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // בדוק הצלחה
        if (result.IsSucceed || result.ReturnCode === 0) {
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                status: 'approved'
            });

            // הפק חשבונית
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
            }

            return new Response(JSON.stringify({
                success: true,
                paymentId: payment.id,
                referenceNumber: result.ReferenceNumber
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                status: 'failed',
                return_message: result.ReturnMessage
            });

            return new Response(JSON.stringify({
                success: false,
                error: result.ReturnMessage || 'Payment failed'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

    } catch (error) {
        console.error('Charge payment error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});