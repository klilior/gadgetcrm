Deno.serve(async (req) => {
    const timestamp = new Date().toISOString();
    
    console.log(`🔥 TEST ENDPOINT CALLED at ${timestamp}`);
    console.log(`Method: ${req.method}`);
    console.log(`URL: ${req.url}`);
    
    // Log all headers
    const headers = {};
    for (const [key, value] of req.headers.entries()) {
        headers[key] = value;
        console.log(`Header ${key}: ${value}`);
    }
    
    // If POST, log the body
    let body = null;
    if (req.method === 'POST') {
        const text = await req.text();
        console.log(`Body: ${text}`);
        try {
            body = JSON.parse(text);
        } catch {
            body = { raw: text };
        }
    }
    
    return new Response(JSON.stringify({
        success: true,
        message: "Test endpoint is working!",
        timestamp: timestamp,
        method: req.method,
        received: { headers, body }
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
});