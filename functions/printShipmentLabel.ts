import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const PLUGINS_BASE = 'https://plugins.ship.co.il';
const API_BASE = 'https://api.ship.co.il';

async function getToken(baseUrl, username, password, scope) {
  const body = new URLSearchParams({
    username,
    password,
    scope,
    grant_type: 'password'
  });

  const res = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Failed to get token: ' + JSON.stringify(data));
  }
  return data.access_token;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tracking_number, label_format } = await req.json();

  if (!tracking_number) {
    return Response.json({ error: 'חסר מספר מעקב' }, { status: 400 });
  }

  console.log(`🖨️ Printing label for tracking: ${tracking_number}, format: ${label_format || 'thermal'}`);

  const username = Deno.env.get('SHIP_USERNAME');
  const password = Deno.env.get('SHIP_PASSWORD');
  const scope = Deno.env.get('SHIP_SCOPE');

  // Try API server first (api.ship.co.il) for PrintWBOrderDetails
  try {
    const apiToken = await getToken(API_BASE, username, password, scope);
    
    // LabelFormat: 1 = Thermal, 2 = A4
    const formatNum = label_format === 'a4' ? 2 : 1;
    
    const params = new URLSearchParams({
      'TrackingNumbers': tracking_number,
      'Copies': '1',
      'AutoPrint': '1',
      'Type': 'Hebrew',
      'LabelFormat': String(formatNum)
    });

    const url = `${API_BASE}/api/v1/shipments/PrintWBOrderDetails?${params.toString()}`;
    console.log(`GET ${url}`);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    });

    const responseText = await res.text();
    console.log(`Response status: ${res.status}, length: ${responseText.length}`);
    console.log(`Response preview: ${responseText.substring(0, 300)}`);

    let response;
    try { response = JSON.parse(responseText); } catch { response = { raw: responseText }; }

    // Check if we got a PDF (FileByteArray)
    if (response.FileByteArray) {
      console.log(`✅ Got PDF label, base64 length: ${response.FileByteArray.length}`);
      return Response.json({
        success: true,
        pdf_base64: response.FileByteArray,
        source: 'api_server'
      });
    }

    // Maybe the response itself is binary PDF
    if (res.headers.get('content-type')?.includes('pdf')) {
      const base64 = btoa(responseText);
      console.log(`✅ Got direct PDF, length: ${base64.length}`);
      return Response.json({
        success: true,
        pdf_base64: base64,
        source: 'api_server_direct'
      });
    }

    // Log what we got for debugging
    console.log(`⚠️ API server response (no FileByteArray):`, JSON.stringify(response).substring(0, 500));
    
    // Return whatever we got for debugging
    return Response.json({
      success: false,
      error: response.Message || response.ErrorMessage || 'לא התקבל PDF מהשרת',
      debug_response: response,
      source: 'api_server'
    });

  } catch (err) {
    console.error(`❌ API server error: ${err.message}`);
    
    // Fallback: try plugins server
    try {
      const pluginsToken = await getToken(PLUGINS_BASE, username, password, scope);
      
      const params = new URLSearchParams({
        'TrackingNumbers': tracking_number,
        'Copies': '1',
        'AutoPrint': '1',
        'Type': 'Hebrew',
        'LabelFormat': label_format === 'a4' ? '2' : '1'
      });

      const url = `${PLUGINS_BASE}/api/v1/shipments/PrintWBOrderDetails?${params.toString()}`;
      console.log(`Fallback GET ${url}`);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${pluginsToken}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(15000)
      });

      const responseText = await res.text();
      console.log(`Fallback status: ${res.status}, length: ${responseText.length}`);

      let response;
      try { response = JSON.parse(responseText); } catch { response = { raw: responseText }; }

      if (response.FileByteArray) {
        console.log(`✅ Got PDF from fallback`);
        return Response.json({
          success: true,
          pdf_base64: response.FileByteArray,
          source: 'plugins_server'
        });
      }

      return Response.json({
        success: false,
        error: 'לא התקבל PDF משני השרתים',
        api_error: err.message,
        fallback_response: response
      });

    } catch (fallbackErr) {
      return Response.json({
        success: false,
        error: `שגיאה בשני השרתים: API=${err.message}, Plugins=${fallbackErr.message}`
      });
    }
  }
});