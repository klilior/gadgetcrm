import { createClientFromRequest } from 'npm:@base44/sdk@0.5.0';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        // Log all details about the request
        console.log("🔍 Test webhook called!");
        console.log("Method:", req.method);
        console.log("URL:", req.url);
        
        // Log headers
        const headers = {};
        for (const [key, value] of req.headers.entries()) {
            headers[key] = value;
        }
        console.log("Headers:", headers);
        
        // Log body if it exists
        let body = null;
        if (req.method === 'POST') {
            const text = await req.text();
            console.log("Raw Body:", text);
            
            try {
                body = JSON.parse(text);
                console.log("Parsed Body:", body);
            } catch (e) {
                console.log("Body is not valid JSON:", e.message);
            }
        }
        
        // Store in webhook log
        await base44.asServiceRole.entities.WebhookLog.create({
            source: 'test-endpoint',
            payload: { method: req.method, body, headers },
            headers
        });
        
        return new Response(JSON.stringify({
            success: true,
            message: "Test webhook received successfully",
            timestamp: new Date().toISOString(),
            received: { body, headers }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error("Test webhook error:", error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message
        }), {
            status: 200, // Still return 200 so Bot.it doesn't think there's an error
            headers: { 'Content-Type': 'application/json' }
        });
    }
});