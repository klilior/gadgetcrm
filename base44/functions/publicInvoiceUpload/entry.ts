import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { SHELL_CALLERS, planShellOwnership } from '../../shared/invoiceShellOwnership.ts';

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);

function dataUrlToBytes(dataUrl) {
  const parts = String(dataUrl || '').split(',');
  const base64 = parts.length > 1 ? parts[1] : parts[0];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanFileName(name, mime) {
  const fallback = mime === 'application/pdf' ? 'invoice.pdf' : 'invoice.jpg';
  return String(name || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || fallback;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const fileName = cleanFileName(body.file_name, body.file_mime);
    const fileMime = String(body.file_mime || '').toLowerCase();
    const uploadedBy = String(body.uploaded_by || 'קישור העלאה מהיר').trim().slice(0, 100);

    if (!body.file_data) return Response.json({ error: 'Missing file data' }, { status: 400 });
    if (!ALLOWED_TYPES.has(fileMime)) return Response.json({ error: 'Unsupported file type' }, { status: 400 });

    const bytes = dataUrlToBytes(body.file_data);
    if (bytes.byteLength > MAX_FILE_SIZE) return Response.json({ error: 'File too large' }, { status: 413 });

    const file = new File([bytes], fileName, { type: fileMime });
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    const fileUrl = uploadResult?.file_url;
    if (!fileUrl) throw new Error('Upload failed');

    const fileHash = await sha256(bytes);
    const intake = await base44.asServiceRole.entities.InvoiceIntakeRaw.create({
      source: 'MOBILE',
      received_at: new Date().toISOString(),
      uploaded_by: uploadedBy,
      file: fileUrl,
      file_hash: fileHash,
      file_hash_algorithm: 'SHA-256',
      file_name: fileName,
      file_mime: fileMime,
      status: 'חדש',
      status_reason: `הועלה מקישור מהיר (${uploadedBy})`,
      processing_status: 'IDLE',
      attempt_count: 0
    });

    // D2b1: this route accepts the file only. processIntakeAutomation is the single automatic
    // shell creator, so no competing creator is invoked here — that removes the upload/automation
    // race that could produce two shells for one intake.
    const ownership = planShellOwnership(SHELL_CALLERS.PUBLIC_UPLOAD);
    const current = (await base44.asServiceRole.entities.InvoiceIntakeRaw.filter({ id: intake.id }, undefined, 1))?.[0];

    return Response.json({
      success: true,
      status: 'accepted',
      processing_status: current?.processing_status || 'IDLE',
      intake_id: intake.id,
      invoice_id: current?.linked_invoice || null,
      shell_owner: ownership,
      pending: !current?.linked_invoice
    });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});