import { base44 } from '@/api/base44Client';
import { applyHumanSelection, appendProcessingEvent } from '../../../base44/shared/invoiceProvenance.ts';
import { parseReviewJson, reviewCategory, reviewArithmetic, stableLinePattern, monetaryCorrectionExample } from '../../../base44/shared/invoiceReviewPolicy.ts';

export async function learnReviewedInvoice(invoice, lines, example = null) {
  if (!invoice.supplier) return;
  const patterns = [];
  const extraction = parseReviewJson(invoice.ai_debug_last_extraction_json);
  for (const name of [extraction.supplier_name, extraction.supplier_name_normalized]) {
    if (name?.trim()) patterns.push({pattern_type:'name_pattern', pattern_value:name.trim()});
  }
  for (const line of lines || []) {
    if (!['goods','fixed'].includes(line.line_category)) continue;
    const name = stableLinePattern(line.product_name);
    const sku = stableLinePattern(line.sku);
    if (name) patterns.push({pattern_type:'line_name_classification',pattern_value:name,classification:line.line_category});
    if (sku) patterns.push({pattern_type:'line_sku_classification',pattern_value:sku,classification:line.line_category});
  }
  if (example) patterns.push({pattern_type:'amount_review_example',pattern_value:JSON.stringify(example)});
  const seen = new Set();
  for (const pattern of patterns) {
    const key = pattern.pattern_type + ':' + pattern.pattern_value;
    if (seen.has(key)) continue;
    seen.add(key);
    const filter = pattern.pattern_type === 'amount_review_example'
      ? {supplier_id:invoice.supplier,pattern_type:pattern.pattern_type,learned_from_invoice:invoice.id}
      : {supplier_id:invoice.supplier,pattern_type:pattern.pattern_type,pattern_value:pattern.pattern_value};
    const existing = await base44.entities.SupplierPattern.filter(filter, undefined, 1);
    const data = {...pattern,supplier_id:invoice.supplier,learned_from_invoice:invoice.id,is_active:true,confidence:100};
    if (existing[0]) await base44.entities.SupplierPattern.update(existing[0].id,data);
    else await base44.entities.SupplierPattern.create(data);
  }
}

/** Both save and approve use this path. Raw AI extraction is immutable during manual editing. */
export async function saveInvoiceReview({selected, user, approve = false, classificationOnly = false}) {
  const original = (await base44.entities.Invoices.filter({id:selected.id},undefined,1))[0];
  if (!original) throw new Error('החשבונית לא נמצאה');
  if (selected.updated_date && original.updated_date !== selected.updated_date) throw new Error('החשבונית השתנתה מאז שנפתחה. יש לפתוח אותה מחדש לפני שמירה.');
  if (original.source_intake) {
    const intake=(await base44.entities.InvoiceIntakeRaw.filter({id:original.source_intake},undefined,1))[0];
    if (intake?.processing_status === 'PROCESSING' && Date.now()-Date.parse(intake.last_attempt_at || '') < 15*60*1000) throw new Error('המסמך עדיין בעיבוד. יש להמתין לסיומו ולפתוח מחדש.');
  }
  const category = reviewCategory(selected);
  if (!classificationOnly && selected.supplier && (selected._supplierName || selected._editedVatId)) {
    const supplier = (await base44.entities.Suppliers.filter({id:selected.supplier},undefined,1))[0];
    const edits = {};
    if (selected._supplierName?.trim() && selected._supplierName.trim() !== supplier?.name) edits.name=selected._supplierName.trim();
    if (selected._editedVatId?.trim() && selected._editedVatId.trim() !== supplier?.vat_id) edits.vat_id=selected._editedVatId.trim();
    if (Object.keys(edits).length) await base44.entities.Suppliers.update(selected.supplier,edits);
  }
  const fields = classificationOnly ? [] : ['supplier','doc_type','doc_number','doc_date','currency','subtotal_before_vat','vat_amount','total_with_vat','notes'];
  const payload = {};
  for (const key of fields) {
    if (selected[key] === undefined) continue;
    const value = selected[key];
    payload[key] = ['subtotal_before_vat','vat_amount','total_with_vat'].includes(key)
      ? (value === '' || value == null ? null : Number(value)) : value;
    if (typeof payload[key] === 'number' && !Number.isFinite(payload[key])) throw new Error('יש להזין סכומים תקינים');
  }
  Object.assign(payload, {
    expense_category:selected.expense_category || null,
    is_goods_invoice:category === 'goods',
    is_recurring_expense:!!selected.is_recurring_expense,
    classification_status:'manually_corrected',
    invoice_classification:category || selected.invoice_classification || null,
    classification_reason:'סיווג שנשמר בבדיקה ידנית',
    auto_approved:false
  });
  if (approve) {
    const check = reviewArithmetic({...original,...payload});
    if (!check.ok) throw new Error(check.reason);
    if (!(payload.supplier || original.supplier) || !(payload.doc_number || original.doc_number) || !(payload.doc_date || original.doc_date)) throw new Error('לפני אישור יש להשלים ספק, מספר מסמך ותאריך.');
  }
  const existingLines = await base44.entities.InvoiceLine.filter({invoice_id:selected.id},'line_number',500);
  const lineItems = classificationOnly ? existingLines : (selected._lineItems || existingLines);
  const records = lineItems.filter(line=>line.sku || line.product_name).map((line,index)=>{
    const data = {line_number:index+1,invoice_id:selected.id,supplier_id:selected.supplier || original.supplier,
      sku:line.sku || '',product_name:line.product_name || line.sku,
      line_provenance_json:JSON.stringify({human:{at:new Date().toISOString(),values:{quantity:line.quantity,unit_price_before_vat:line.unit_price_before_vat,line_total_before_vat:line.line_total_before_vat,line_total_with_vat:line.line_total_with_vat}},previous:parseReviewJson(existingLines.find(old=>Number(old.line_number)===index+1)?.line_provenance_json)})};
    for (const key of ['quantity','unit_price_before_vat','line_total_before_vat','line_total_with_vat']) {
      data[key] = line[key] === '' || line[key] == null ? (key === 'quantity' ? 1 : null) : Number(line[key]);
      if (data[key] != null && !Number.isFinite(data[key])) throw new Error('יש להזין ערכים תקינים בשורות');
    }
    data.line_category = line.line_category || category || null;
    if (classificationOnly) data.line_category = category || line.line_category;
    data.classification_source = 'manual';
    data.classification_reason = 'סיווג שורה שנשמר בבדיקה ידנית';
    delete data.id; delete data.created_date; delete data.updated_date; delete data.created_by; delete data.created_by_id;
    return data;
  });
  const changes = Object.fromEntries(Object.entries(payload).filter(([key,value])=> original[key] !== value));
  payload.field_provenance_json = applyHumanSelection({existingJson:original.field_provenance_json,values:changes,user:user?.email || user?.employee_name}).json;
  payload.processing_events_json = appendProcessingEvent(original.processing_events_json,{
    type:'HUMAN_EDIT',outcome:approve?'review_and_approve':'saved',reason:selected._correctionReason || 'תיקון ידני',
    meta:{fields:Object.keys(changes),line_count:records.length}
  }).json;
  const example = classificationOnly ? null : monetaryCorrectionExample(original,{...original,...payload},{
    supplierName:selected._supplierName,vatId:selected._editedVatId,reason:selected._correctionReason,labelHint:selected._amountLabel
  });
  // Unapprove before side effects: any interrupted save stays visible for review.
  await base44.entities.Invoices.update(original.id,{extraction_status:'ממתין לאימות',auto_approved:false,reviewed_at:null});
  const retained = new Set();
  for (const record of records) {
    const existing = existingLines.find(line=>Number(line.line_number) === record.line_number);
    if (existing) { await base44.entities.InvoiceLine.update(existing.id,record); retained.add(existing.id); }
    else await base44.entities.InvoiceLine.create(record);
  }
  for (const old of existingLines) if (!retained.has(old.id)) await base44.entities.InvoiceLine.delete(old.id);
  await base44.entities.Invoices.update(original.id,payload);
  const merged = {...original,...payload};
  await learnReviewedInvoice(merged,records,example);
  if (approve) {
    const response = await base44.functions.invoke('updateInvoiceStatus',{
      invoice_id:original.id, action:'approve', employee_role:user?.role, employee_email:user?.email || user?.employee_name
    });
    if (response.data?.success !== true) throw new Error(response.data?.error || 'האישור לא הושלם');
  }
  return {learned_amount:!!example, invoice:merged};
}
