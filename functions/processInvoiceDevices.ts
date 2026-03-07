import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';


// Phone normalization
function normalizePhone(raw) {
  if (!raw) return { normalized: null, original: raw };
  const original = String(raw).trim();
  let cleaned = original.replace(/[\s\-\(\)\.]/g, '');
  
  // Convert +972 to 0
  if (cleaned.startsWith('+972')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('972') && cleaned.length > 9) {
    cleaned = '0' + cleaned.slice(3);
  }
  
  return { normalized: cleaned, original };
}

// Detect manufacturer from product name
function detectManufacturer(productName) {
  if (!productName) return 'אחר';
  const lower = productName.toLowerCase();
  if (lower.includes('apple') || lower.includes('iphone') || lower.includes('ipad')) return 'Apple';
  if (lower.includes('samsung') || lower.includes('galaxy')) return 'Samsung';
  if (lower.includes('xiaomi') || lower.includes('redmi') || lower.includes('poco')) return 'Xiaomi';
  if (lower.includes('טאבלט') || lower.includes('tablet')) return 'טאבלט';
  return 'אחר';
}

// Check if category is a smartphone/device
const PHONE_CATEGORIES = ['טלפונים סלולרים', 'טלפונים סלולריים', 'סלולר', 'smartphones', 'phones', 'סמארטפונים', 'סמארטפונים כשרים', 'טאבלטים', 'מכשירים'];
function isSmartphoneCategory(category) {
  if (!category) return false;
  const lower = category.toLowerCase();
  return PHONE_CATEGORIES.some(cat => lower.includes(cat.toLowerCase()));
}

// Keywords in product name that indicate a device
const DEVICE_NAME_KEYWORDS = ['iphone', 'samsung', 'galaxy', 'xiaomi', 'redmi', 'poco', 'pixel', 'ipad', 'macbook', 'airpods', 'apple watch', 'huawei', 'oneplus', 'oppo', 'vivo', 'realme', 'nothing phone', 'motorola', 'nokia', 'honor', 'סלולרי', 'טלפון סלולרי'];
function isDeviceByName(productName) {
  if (!productName) return false;
  const lower = productName.toLowerCase();
  return DEVICE_NAME_KEYWORDS.some(kw => lower.includes(kw));
}

// Check if a line item is a device - by category, name, or serial number
function isDeviceLine(line, enrichedCategories) {
  const category = line.category_name || enrichedCategories?.[line.sku] || '';
  if (isSmartphoneCategory(category)) return true;
  if (isDeviceByName(line.name)) return true;
  // If line has a serial number, it's likely a device
  if (line.serial && String(line.serial).trim().length >= 10) return true;
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { documents, dry_run = false } = body;

    // Can be called internally from linetSyncCore or manually
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return Response.json({ error: 'documents array is required' }, { status: 400 });
    }

    console.log(`📱 Processing ${documents.length} documents for customer-device matching...`);

    const stats = {
      docs_processed: 0,
      customers_matched: 0,
      customers_created: 0,
      devices_created: 0,
      devices_skipped_duplicate: 0,
      devices_skipped_no_phone: 0,
      items_not_phone: 0,
      errors: []
    };

    for (const doc of documents) {
      try {
        stats.docs_processed++;

        const linet_doc_id = String(doc.id);
        const doc_number = String(doc.docnum || '');
        const issue_date = doc.issue_date ? doc.issue_date.split(' ')[0] : null;
        const customer_name = doc.company_name || doc.account_name || doc.company || '';
        const linet_account_id = doc.account_id ? Number(doc.account_id) : null;
        const raw_doctype = Number(doc.doctype);
        
        // Skip credit invoices
        if (raw_doctype === 4) continue;

        // Get phone from doc
        const rawPhone = doc.phone || doc.mobile || doc.account_phone || null;
        const { normalized: phoneNormalized, original: phoneOriginal } = normalizePhone(rawPhone);

        // Check if this document has any device line items (by category, name, or serial)
        const lineItems = Array.isArray(doc.docDetailes) ? doc.docDetailes : [];
        const enrichedCategories = doc._enriched_categories || {};
        const smartphoneItems = lineItems.filter(line => isDeviceLine(line, enrichedCategories));

        if (smartphoneItems.length === 0) {
          stats.items_not_phone += lineItems.length;
          continue;
        }

        // --- Step 2: Find or create customer ---
        if (!phoneNormalized && !customer_name) {
          stats.devices_skipped_no_phone += smartphoneItems.length;
          stats.errors.push({
            doc_number,
            error: 'Missing phone and customer name',
            customer_name
          });
          continue;
        }

        let clientId = null;

        if (!dry_run) {
          // Search by normalized phone
          let clients = await base44.asServiceRole.entities.Client.filter({ phone: phoneNormalized }, null, 1);
          
          // If not found, try original phone
          if (clients.length === 0 && phoneOriginal !== phoneNormalized) {
            clients = await base44.asServiceRole.entities.Client.filter({ phone: phoneOriginal }, null, 1);
          }

          // If not found, try by linet_account_id
          if (clients.length === 0 && linet_account_id) {
            clients = await base44.asServiceRole.entities.Client.filter({ linet_account_id }, null, 1);
          }

          // If not found, try by customer name (exact match)
          if (clients.length === 0 && customer_name) {
            clients = await base44.asServiceRole.entities.Client.filter({ full_name: customer_name }, null, 5);
            // If multiple matches, prefer one with matching phone
            if (clients.length > 1 && phoneNormalized) {
              const withPhone = clients.filter(c => c.phone === phoneNormalized);
              if (withPhone.length > 0) clients = withPhone;
            }
          }

          if (clients.length > 0) {
            clientId = clients[0].id;
            stats.customers_matched++;

            // Update missing fields
            const updates = {};
            if (!clients[0].linet_account_id && linet_account_id) updates.linet_account_id = linet_account_id;
            if (!clients[0].phone && phoneNormalized) updates.phone = phoneNormalized;
            if (!clients[0].phone_original && phoneOriginal) updates.phone_original = phoneOriginal;
            if (!clients[0].source) updates.source = 'Linet Invoice';
            if (Object.keys(updates).length > 0) {
              await base44.asServiceRole.entities.Client.update(clientId, updates);
            }
          } else {
            // Create new customer
            const newClient = await base44.asServiceRole.entities.Client.create({
              full_name: customer_name || 'לקוח חדש',
              phone: phoneNormalized,
              phone_original: phoneOriginal,
              linet_account_id,
              source: 'Linet Invoice'
            });
            clientId = newClient.id;
            stats.customers_created++;
          }
        }

        // --- Step 3: Create devices for smartphone items ---
        for (const line of smartphoneItems) {
          try {
            const productName = line.name || '';
            const sku = line.sku || '';
            // Linet sends serial in the 'serial' field
            const rawSerial = line.serial || line.serial_number || line.imei || '';
            const serialNumber = String(rawSerial).trim();
            const quantity = Math.abs(parseFloat(line.qty) || 1);
            
            console.log(`  📱 Device line: ${productName} | SKU: ${sku} | Serial: ${serialNumber || 'NONE'} | Qty: ${quantity}`);

            if (dry_run) {
              stats.devices_created++;
              continue;
            }

            // --- Step 4: Duplicate prevention ---
            if (serialNumber) {
              // Check by serial number
              const existingBySerial = await base44.asServiceRole.entities.RepairDevice.filter(
                { serial_imei: serialNumber }, null, 1
              );

              if (existingBySerial.length > 0) {
                const existingDevice = existingBySerial[0];
                // Update missing fields
                const deviceUpdates = {};
                if (!existingDevice.purchase_invoice_id) deviceUpdates.purchase_invoice_id = linet_doc_id;
                if (!existingDevice.purchase_invoice_number) deviceUpdates.purchase_invoice_number = doc_number;
                if (!existingDevice.purchase_date && issue_date) deviceUpdates.purchase_date = issue_date;
                if (!existingDevice.sku && sku) deviceUpdates.sku = sku;
                
                if (existingDevice.client_id !== clientId) {
                  stats.errors.push({
                    doc_number,
                    error: `Serial ${serialNumber} exists under different client (${existingDevice.client_id} vs ${clientId})`,
                    product: productName
                  });
                }

                if (Object.keys(deviceUpdates).length > 0) {
                  await base44.asServiceRole.entities.RepairDevice.update(existingDevice.id, deviceUpdates);
                }
                stats.devices_skipped_duplicate++;
                continue;
              }
            } else {
              // No serial - check by model + invoice
              const existingByModel = await base44.asServiceRole.entities.RepairDevice.filter(
                { client_id: clientId, model: productName, purchase_invoice_id: linet_doc_id }, null, 1
              );
              if (existingByModel.length > 0) {
                stats.devices_skipped_duplicate++;
                continue;
              }
            }

            // Create the device
            const manufacturer = detectManufacturer(productName);
            
            // For quantity > 1 without serial, create multiple devices
            const devicesToCreate = serialNumber ? 1 : Math.min(quantity, 5); // cap at 5 to avoid errors
            
            for (let i = 0; i < devicesToCreate; i++) {
              await base44.asServiceRole.entities.RepairDevice.create({
                client_id: clientId,
                manufacturer,
                model: productName,
                serial_imei: serialNumber || `PENDING-${linet_doc_id}-${sku}-${i}`,
                color: 'אחר',
                sku,
                purchase_invoice_id: linet_doc_id,
                purchase_invoice_number: doc_number,
                purchase_date: issue_date,
                source: 'Linet Invoice'
              });
              stats.devices_created++;
            }

          } catch (lineErr) {
            stats.errors.push({
              doc_number,
              error: lineErr.message,
              product: line.name
            });
          }
        }

      } catch (docErr) {
        stats.errors.push({
          doc_id: doc.id,
          error: docErr.message
        });
      }
    }

    console.log(`✅ Invoice-device processing complete:`, JSON.stringify(stats));

    return Response.json({
      success: true,
      stats,
      message: `עובד: ${stats.docs_processed} מסמכים, ${stats.customers_matched} לקוחות זוהו, ${stats.customers_created} לקוחות נוצרו, ${stats.devices_created} מכשירים נוצרו`
    });

  } catch (error) {
    console.error('❌ processInvoiceDevices error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});