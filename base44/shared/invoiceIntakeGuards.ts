export function isLikelyInlineOrPreviewImage(intake) {
  const name = String(intake?.file_name || '').trim().toLowerCase();
  const mime = String(intake?.file_mime || '').trim().toLowerCase();
  const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
  if (!isImage) return false;
  return name.startsWith('~') || name.includes('logo') || name.includes('signature') || name.includes('image00') || name.includes('cid:');
}

export function isValidInvoiceFile(intake) {
  if (isLikelyInlineOrPreviewImage(intake) || !intake?.file) return false;
  const mime = String(intake.file_mime || '').toLowerCase();
  if (['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/octet-stream'].includes(mime)) return true;
  const name = String(intake.file_name || '').toLowerCase();
  return ['.pdf', '.jpg', '.jpeg', '.png'].some((ext) => name.endsWith(ext));
}

export function getEarlyNonInvoiceReason(intake) {
  const text = `${intake?.file_name || ''} ${intake?.gmail_subject || ''}`.toLowerCase();
  const positive = ['חשבונית', 'invoice', 'tax invoice', 'זיכוי', 'credit note'];
  if (positive.some((term) => text.includes(term))) return null;
  const negative = ['פרסומת', 'מבצע', 'ניוזלטר', 'newsletter', 'advertisement', 'קטלוג', 'catalog', 'אישור מסירה', 'תעודת משלוח', 'proof of delivery', 'delivery confirmation', 'packing slip', 'order confirmation'];
  const match = negative.find((term) => text.includes(term));
  return match ? `סונן לפני AI: המסמך זוהה כ-${match} לפי שם הקובץ או נושא המייל.` : null;
}

export async function calculateFileHash(fileUrl) {
  if (!fileUrl) return null;
  const response = await fetch(fileUrl);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function findReusableDuplicate(intakes, currentId) {
  const others = (intakes || []).filter((item) => item.id !== currentId);
  return others.find((item) => item.linked_invoice && item.ai_debug_last_extraction_json) ||
    others.find((item) => item.linked_invoice) || others[0] || null;
}