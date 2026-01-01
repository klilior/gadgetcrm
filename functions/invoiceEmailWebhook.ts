import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Webhook for receiving invoice emails from Make.com
 * 
 * Expected payload from Make:
 * {
 *   "token": "GMAIL_INBOUND_WEBHOOK_TOKEN",
 *   "from": "supplier@example.com",
 *   "subject": "חשבונית מס 12345",
 *   "date": "2024-01-15T10:30:00Z",
 *   "message_id": "unique-message-id",
 *   "file_url": "https://...",  // URL of uploaded file from Make
 *   "file_name": "invoice.pdf",
 *   "file_mime": "application/pdf"
 * }
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    // Handle both JSON and FormData
    let payload;
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      payload = {};
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          // Upload file to Base44
          const { file_url } = await base44.integrations.Core.UploadFile({ file: value });
          payload.file_url = file_url;
          payload.file_name = value.name;
          payload.file_mime = value.type;
        } else {
          payload[key] = value;
        }
      }
    } else {
      payload = await req.json();
    }
    
    const { 
      token, 
      from, 
      subject, 
      date, 
      message_id, 
      file_url, 
      file_name, 
      file_mime 
    } = payload;
    
    // Validate token
    const expectedToken = Deno.env.get('GMAIL_INBOUND_WEBHOOK_TOKEN');
    if (token !== expectedToken) {
      console.error('Invalid token received');
      return Response.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }
    
    // Validate file
    if (!file_url) {
      return Response.json({ success: false, error: 'No file provided' }, { status: 400 });
    }
    
    // Check for duplicate by message_id
    if (message_id) {
      const existing = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({
        gmail_message_id: message_id
      }, undefined, 1);
      
      if (existing.length > 0) {
        console.log(`Duplicate message_id: ${message_id}`);
        return Response.json({ 
          success: true, 
          skipped: true, 
          reason: 'Duplicate message',
          intake_id: existing[0].id 
        });
      }
    }
    
    // Generate file hash from URL (simple hash for dedup)
    const fileHash = await generateSimpleHash(file_url + (file_name || ''));
    
    // Create intake record
    const intake = await base44.asServiceRole.entities.InvoiceIntakeRaw.create({
      source: 'GMAIL',
      received_at: date || new Date().toISOString(),
      uploaded_by: 'מערכת (Make.com)',
      file: file_url,
      file_hash: fileHash,
      file_name: file_name || 'invoice',
      file_mime: file_mime || 'application/pdf',
      gmail_message_id: message_id || null,
      gmail_from: from || null,
      gmail_subject: subject || null,
      gmail_date: date || null,
      status: 'חדש'
    });
    
    console.log(`Created intake: ${intake.id}`);
    
    // Trigger processing pipeline
    let processingResult = null;
    try {
      processingResult = await base44.asServiceRole.functions.invoke('processIntake', { 
        intake_id: intake.id 
      });
      console.log(`Processing triggered for intake: ${intake.id}`);
    } catch (procErr) {
      console.error(`Processing error: ${procErr.message}`);
    }
    
    return Response.json({ 
      success: true, 
      intake_id: intake.id,
      processing: processingResult?.data || null
    });
    
  } catch (error) {
    console.error('Invoice Email Webhook Error:', error.message);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});

async function generateSimpleHash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}