import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req).asServiceRole;
    
    try {
        const { paymentId } = await req.json();

        if (!paymentId) {
            return new Response(JSON.stringify({ error: 'Missing paymentId' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // טען תשלום
        const payment = await base44.entities.Payment.get(paymentId);

        if (payment.invoice_issued) {
            return new Response(JSON.stringify({ 
                success: true, 
                message: 'Invoice already issued' 
            }), { 
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // טען הגדרות Linet
        const settings = await base44.entities.PaymentSettings.filter({
            setting_group: 'linet'
        });

        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.setting_key] = s.setting_value;
        });

        const linetUser = settingsMap['linet_user'];
        const linetApiKey = settingsMap['linet_api_key'];
        const linetCompany = settingsMap['linet_login_company'];
        const baseUrl = settingsMap['linet_base_url'] || 'https://tax.linet.app';

        if (!linetUser || !linetApiKey || !linetCompany) {
            console.log('Linet not configured, skipping invoice');
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Linet not configured' 
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // טען לקוח
        const customer = payment.customer_id 
            ? await base44.entities.Client.get(payment.customer_id)
            : null;

        // הכן payload ללינט
        const linetPayload = {
            customer: {
                name: customer?.full_name || 'לקוח',
                email: customer?.email || '',
                phone: customer?.phone || ''
            },
            lines: [{
                description: `תשלום עבור הזמנה ${payment.order_id || 'N/A'}`,
                qty: 1,
                unitPrice: payment.amount,
                vatPercent: 17
            }],
            currency: 'ILS',
            orderId: payment.order_id,
            paymentRef: payment.zcredit_reference_number,
            issueDate: new Date().toISOString().split('T')[0]
        };

        // TODO: להשלים את ה-endpoint המדויק של Linet לפי ה-docs שלהם
        const linetUrl = `${baseUrl}/api/documents`; // להשלים

        const response = await fetch(linetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'user': linetUser,
                'api_key': linetApiKey,
                'login_company': linetCompany
            },
            body: JSON.stringify(linetPayload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Linet error:', errorText);
            throw new Error(`Linet error: ${response.status}`);
        }

        const result = await response.json();

        // עדכן תשלום
        await base44.entities.Payment.update(paymentId, {
            invoice_issued: true,
            linet_document_id: result.id || result.documentId,
            linet_document_url: result.url || result.documentUrl
        });

        return new Response(JSON.stringify({
            success: true,
            documentId: result.id || result.documentId,
            documentUrl: result.url || result.documentUrl
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Create Linet invoice error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});