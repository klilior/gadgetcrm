import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { calculateFileHash } from '../../shared/invoiceIntakeGuards.ts';
import { FILE_HASH_ALGORITHM, findGmailDuplicate } from '../../shared/invoiceIntakeIdentity.ts';

/**
 * Webhook for receiving invoice emails from Make.com
 * Supports both multipart/form-data (with file) and JSON (with file_url)
 *
 * D1 identity rules:
 * - file_hash is ALWAYS the SHA-256 of the actual file bytes (never a hash of url/name/ids).
 * - gmail_message_id stays the exact message id; gmail_attachment_id is stored separately.
 * - Dedupe is exact-equality on attachment id first, else exact message id (no regex/substring),
 *   so a repeated identical webhook returns the existing intake/invoice and creates nothing.
 */

function isLikelyInlineOrPreviewImage(fileName, fileMime) {
  const name = (fileName || '').trim().toLowerCase();
  const mime = (fileMime || '').trim().toLowerCase();
  const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
  if (!isImage) return false;
  return name.startsWith('~') || name.includes('logo') || name.includes('signature') || name.includes('image00') || name.includes('cid:');
}

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
        // Upload binary file to Base44 (use service role since this is a webhook with no user session)
        const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: fileField });
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

    if (isLikelyInlineOrPreviewImage(file_name, file_mime)) {
      console.log(`Skipping inline/preview image attachment: ${file_name || 'unnamed'}`);
      return Response.json({
        success: true,
        skipped: true,
        reason: 'Inline or preview image attachment - not an invoice source file'
      });
    }

    const exactAttachmentId = String(attachment_id || '').trim() || null;
    const exactMessageId = String(message_id || '').trim() || null;

    // Exact-identity dedupe. Legacy combined ids are read as a fallback by gmailIdentity().
    if (exactAttachmentId || exactMessageId) {
      const candidates = [];
      if (exactAttachmentId) {
        candidates.push(...await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ gmail_attachment_id: exactAttachmentId }, undefined, 50));
      }
      if (exactMessageId) {
        candidates.push(...await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ gmail_message_id: exactMessageId }, undefined, 50));
        if (exactAttachmentId) {
          // Legacy combined form: `${message_id}__${attachment_id}`.
          candidates.push(...await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ gmail_message_id: `${exactMessageId}__${exactAttachmentId}` }, undefined, 50));
        }
      }
      const duplicate = findGmailDuplicate(candidates, { gmail_attachment_id: exactAttachmentId, gmail_message_id: exactMessageId }, null);
      if (duplicate) {
        console.log(`Duplicate detected (${duplicate.reason_code}): ${exactAttachmentId || exactMessageId}`);
        return Response.json({
          success: true,
          skipped: true,
          reason: 'Duplicate attachment',
          reason_code: duplicate.reason_code,
          intake_id: duplicate.intake.id,
          linked_invoice_id: duplicate.intake.linked_invoice || null
        });
      }
    }

    // Real file identity: SHA-256 of the actual file bytes only.
    const fileHash = await calculateFileHash(file_url).catch(() => null);

    // Create intake record with status "מוכן לניתוח"
    const intake = await base44.asServiceRole.entities.InvoiceIntakeRaw.create({
      source: 'GMAIL',
      received_at: date || new Date().toISOString(),
      uploaded_by: 'מערכת (Gmail Auto)',
      file: file_url,
      file_hash: fileHash || undefined,
      file_hash_algorithm: fileHash ? FILE_HASH_ALGORITHM : undefined,
      file_name: file_name || 'invoice',
      file_mime: file_mime || 'application/pdf',
      gmail_message_id: exactMessageId,
      gmail_attachment_id: exactAttachmentId,
      gmail_from: from || null,
      gmail_subject: subject || null,
      gmail_date: date || null,
      status: 'מוכן לניתוח'
    });
    
    console.log(`Created intake: ${intake.id}`);
    
    // The processIntakeAutomation entity automation will handle:
    // 1. Creating the invoice shell
    // 2. Linking intake <-> invoice
    // 3. Triggering AI extraction
    // No need to call processIntake or runInvoiceExtractionByInvoice here.
    
    return Response.json({ 
      success: true, 
      intake_id: intake.id
    });
    
  } catch (error) {
    console.error('Invoice Email Webhook Error:', error.message);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});