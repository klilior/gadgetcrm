import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { v4 as uuidv4 } from 'npm:uuid@9.0.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        console.log("🔵 [Payment] Starting payment session creation...");
        
        // אימות משתמש
        let user = null;
        try {
            user = await base44.auth.me();
            if (!user) {
                console.error("❌ [Payment] No user authenticated");
                return Response.json({ success: false, error: 'נדרשת התחברות' }, { status: 401 });
            }
            console.log(`✅ [Payment] User authenticated: ${user.email}`);
        } catch (authError) {
            console.error("❌ [Payment] Auth error:", authError.message);
            return Response.json({ success: false, error: 'שגיאת אימות' }, { status: 401 });
        }

        // קריאת נתוני הבקשה
        let requestData;
        try {
            requestData = await req.json();
            console.log(`📝 [Payment] Request data:`, requestData);
        } catch (parseError) {
            console.error("❌ [Payment] Failed to parse request body:", parseError.message);
            return Response.json({ success: false, error: 'שגיאה בפורמט הבקשה' }, { status: 400 });
        }

        const { orderId, customerId, amount, description, installments } = requestData;

        if (!amount || amount <= 0) {
            console.error("❌ [Payment] Invalid amount:", amount);
            return Response.json({ success: false, error: 'סכום לא תקין' }, { status: 400 });
        }

        // טען הגדרות Z-Credit
        console.log("🔍 [Payment] Loading Z-Credit settings...");
        
        let settings = [];
        try {
            settings = await base44.asServiceRole.entities.PaymentSettings.filter({
                setting_group: 'zcredit'
            });
            console.log(`📊 [Payment] Found ${settings.length} Z-Credit settings`);
        } catch (settingsError) {
            console.error("⚠️ [Payment] Error loading settings:", settingsError.message);
            return Response.json({ 
                success: false,
                error: 'לא ניתן לטעון הגדרות תשלום. נא לפנות למנהל המערכת.' 
            }, { status: 500 });
        }

        const settingsMap = {};
        settings.forEach(s => {
            settingsMap[s.setting_key] = s.setting_value;
            // Do not log values here for security, rely on frontend masking if needed
        });

        const mode = settingsMap['zcredit_mode'] || 'sandbox';
        const terminal = settingsMap['zcredit_terminal'];
        const password = settingsMap['zcredit_password'];
        const origin = req.headers.get("origin") || req.headers.get("referer") || new URL(req.url).origin;
        // Remove trailing slash if present
        const baseUrlStr = origin.endsWith('/') ? origin.slice(0, -1) : origin;
        
        const returnUrl = settingsMap['zcredit_return_url'] || `${baseUrlStr}/PaymentReturn?success=true`;
        const failUrl = settingsMap['zcredit_fail_url'] || `${baseUrlStr}/PaymentReturn?success=false`;

        if (!terminal || !password) {
            console.error("❌ [Payment] Missing Z-Credit credentials");
            return Response.json({ 
                success: false,
                error: '⚠️ Z-Credit לא מוגדר. נא להגדיר מספר מסוף וסיסמה בהגדרות התשלום.' 
            }, { status: 400 }); // Changed to 400 for configuration error
        }

        console.log(`✅ [Payment] Z-Credit credentials loaded. Mode: ${mode}`);

        // יצירת TransactionUniqueID
        const transactionUniqueId = uuidv4();
        console.log(`🆔 [Payment] Generated TransactionUniqueID: ${transactionUniqueId}`);

        // יצירת רשומת תשלום
        console.log("💾 [Payment] Creating payment record...");
        let payment;
        try {
            payment = await base44.asServiceRole.entities.Payment.create({
                order_id: orderId || null, // Ensure null if missing
                customer_id: customerId || null, // Ensure null if missing
                amount,
                currency: 'ILS',
                flow: 'webcheckout',
                transaction_unique_id: transactionUniqueId,
                status: 'pending',
                mode_snapshot: mode,
                installments: installments || 1
            });
            console.log(`✅ [Payment] Payment record created with ID: ${payment.id}`);
        } catch (createError) {
            console.error("❌ [Payment] Failed to create payment record:", createError.message);
            return Response.json({ 
                success: false,
                error: 'שגיאה ביצירת רשומת תשלום: ' + createError.message 
            }, { status: 500 });
        }

        // הכנת הבקשה ל-Z-Credit
        const zcreditRequest = {
            TerminalNumber: terminal,
            Password: password,
            TransactionSum: amount,
            TransactionUniqueID: transactionUniqueId,
            CreditType: installments && installments > 1 ? 8 : 1,
            NumOfPayments: installments || 1,
            ReturnValue: returnUrl,
            CancelReturnValue: failUrl,
            Description: description || `Order ${orderId || 'N/A'}`,
            CreateInvoiceFile: false,
            Use3DS: true
        };

        console.log("📤 [Payment] Sending request to Z-Credit...");

        // שמירת הבקשה
        try {
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                raw_request: zcreditRequest
            });
        } catch (updateError) {
            console.error("⚠️ [Payment] Failed to update payment with request:", updateError.message);
        }

        const baseUrl = mode === 'live' 
            ? 'https://pci.zcredit.co.il/ZCreditWS/api/Transaction'
            : 'https://pcitest.zcredit.co.il/ZCreditWS/api/Transaction';

        console.log(`🌐 [Payment] Z-Credit URL: ${baseUrl}/GetWebCheckoutUrl`);

        // יצירת סשן WebCheckout
        let response;
        try {
            response = await fetch(`${baseUrl}/GetWebCheckoutUrl`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Accept': 'application/json',
                    'User-Agent': 'Base44App/1.0'
                },
                body: JSON.stringify(zcreditRequest)
            });
            console.log(`📥 [Payment] Z-Credit response status: ${response.status}`);
        } catch (fetchError) {
            console.error("❌ [Payment] Network error calling Z-Credit:", fetchError.message);
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                status: 'failed',
                return_message: 'Network error: ' + fetchError.message
            });
            // Return 200 so frontend can process the error message gracefully
            return Response.json({
                success: false,
                error: 'שגיאת תקשורת עם שרת התשלום: ' + fetchError.message
            }, { status: 200 }); 
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ [Payment] Z-Credit API error: ${errorText}`);
            
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                status: 'failed',
                return_message: `Z-Credit API Error: ${response.status} - ${errorText}`
            });

            // Return 200 so frontend can process the error message gracefully
            return Response.json({
                success: false,
                error: `שגיאה בתקשורת עם Z-Credit (${response.status}): ${errorText}`
            }, { status: 200 }); 
        }

        let result;
        try {
            result = await response.json();
            console.log("📊 [Payment] Z-Credit response:", JSON.stringify(result, null, 2));
        } catch (jsonError) {
            console.error("❌ [Payment] Failed to parse Z-Credit response:", jsonError.message);
            return Response.json({
                success: false,
                error: 'שגיאה בפענוח תשובה מ-Z-Credit'
            }, { status: 500 });
        }

        // שמירת התשובה
        try {
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                raw_response: result,
                payment_url: result.url || result.URL,
                zcredit_reference_number: result.ReferenceNumber
            });
        } catch (updateError) {
            console.error("⚠️ [Payment] Failed to update payment with response:", updateError.message);
        }

        if (result.url || result.URL) {
            console.log(`✅ [Payment] Payment URL generated successfully`);
            return Response.json({
                success: true,
                paymentId: payment.id,
                paymentUrl: result.url || result.URL,
                transactionUniqueId
            });
        } else {
            console.error("❌ [Payment] No payment URL in Z-Credit response");
            await base44.asServiceRole.entities.Payment.update(payment.id, {
                status: 'failed',
                return_message: result.ReturnMessage || 'Failed to create payment session'
            });

            return Response.json({
                success: false,
                error: result.ReturnMessage || 'לא הצלחנו ליצור קישור תשלום. נא לבדוק את ההגדרות.'
            }, { status: 400 });
        }

    } catch (error) {
        console.error('❌❌❌ [Payment] Critical error:', error);
        console.error('Stack:', error.stack);
        return Response.json({
            success: false,
            error: 'שגיאה לא צפויה: ' + error.message
        }, { status: 500 });
    }
});