import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Webhook for receiving invoice emails from Make.com
 * Supports both multipart/form-data (with file) and JSON (with file_url)
 * 
 * FormData fields:
 * - token: GMAIL_INBOUND_WEBHOOK_TOKEN
 * - from: sender email
 * - subject: email subject
 * - date: email date
 * - message_id: unique message id
 * - attachment_id: attachment id for idempotency
 * - file: binary file (PDF/image)
 * - file_name: original filename (optional)
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    let token, from, subject, date, message_id, attachment_id, file_url, file_name, file_mime;
    
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      // Handle FormData with binary file
      const formData = await req.formData();
      
      token = formData.get('token');
      from = formData.get('from');
      subject = formData.get('subject');
      date = formData.get('date');
      message_id = formData.get('message_id');
      attachment_id = formData.get('attachment_id');
      file_name = formData.get('file_name');
      
      const fileField = formData.get('file');
      if (fileField && fileField instanceof File) {
        // Upload binary file to Base44
        const uploadResult = await base44.integrations.Core.UploadFile({ file: fileField });
        file_url = uploadResult.file_url;
        file_name = file_name || fileField.name;
        file_mime = fileField.type;
      }
    } else {
      // Handle JSON payload
      const payload = await req.json();
      token = payload.token;
      from = payload.from;
      subject = payload.subject;
      date = payload.date;
      message_id = payload.message_id;
      attachment_id = payload.attachment_id;
      file_url = payload.file_url;
      file_name = payload.file_name;
      file_mime = payload.file_mime;
    }
    
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
    
    // Check for duplicate by attachment_id (primary) or message_id
    const dedupeId = attachment_id || message_id;
    if (dedupeId) {
      const filterQuery = attachment_id 
        ? { gmail_message_id: { $regex: attachment_id } }
        : { gmail_message_id: message_id };
      
      const existing = await base44.asServiceRole.entities.InvoiceIntakeRaw.filter(
        filterQuery, undefined, 1
      );
      
      if (existing.length > 0) {
        console.log(`Duplicate detected: ${dedupeId}`);
        return Response.json({ 
          success: true, 
          skipped: true, 
          reason: 'Duplicate attachment',
          intake_id: existing[0].id,
          linked_invoice_id: existing[0].linked_invoice || null
        });
      }
    }
    
    // Generate file hash
    const fileHash = await generateSimpleHash(file_url + (file_name || '') + (attachment_id || ''));
    
    // Store combined ID for future dedup
    const storedMessageId = attachment_id 
      ? `${message_id || 'msg'}__${attachment_id}` 
      : message_id;
    
    // Create intake record with status "מוכן לניתוח"
    const intake = await base44.asServiceRole.entities.InvoiceIntakeRaw.create({
      source: 'GMAIL',
      received_at: date || new Date().toISOString(),
      uploaded_by: 'מערכת (Gmail Auto)',
      file: file_url,
      file_hash: fileHash,
      file_name: file_name || 'invoice',
      file_mime: file_mime || 'application/pdf',
      gmail_message_id: storedMessageId || null,
      gmail_from: from || null,
      gmail_subject: subject || null,
      gmail_date: date || null,
      status: 'מוכן לניתוח'
    });
    
    console.log(`Created intake: ${intake.id}`);
    
    // Step 1: Process intake (creates invoice shell and links them)
    let linkedInvoiceId = null;
    try {
      const processingResult = await base44.asServiceRole.functions.invoke('processIntake', { 
        intake_id: intake.id 
      });
      linkedInvoiceId = processingResult?.data?.invoice_id || processingResult?.data?.created_invoice_id || null;
      console.log(`Processing completed for intake: ${intake.id}, invoice: ${linkedInvoiceId}`);
    } catch (procErr) {
      console.error(`Processing error: ${procErr.message}`);
    }
    
    // Step 2: Trigger AI extraction on the invoice (separate call to avoid loop detection)
    if (linkedInvoiceId) {
      try {
        const extractionResult = await base44.asServiceRole.functions.invoke('runInvoiceExtractionByInvoice', {
          invoice_id: linkedInvoiceId
        });
        console.log(`Extraction completed for invoice: ${linkedInvoiceId}, success: ${extractionResult?.data?.success}`);
      } catch (extractErr) {
        console.error(`Extraction error for invoice ${linkedInvoiceId}: ${extractErr.message}`);
      }
    }
    
    return Response.json({ 
      success: true, 
      intake_id: intake.id,
      linked_invoice_id: linkedInvoiceId
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