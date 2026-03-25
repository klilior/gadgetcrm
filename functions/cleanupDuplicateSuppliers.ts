import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Normalize VAT ID - remove non-alphanumeric, uppercase
function normalizeVatId(vatId) {
  if (!vatId) return null;
  return vatId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

// Normalize supplier name for comparison
function normalizeSupplierName(name) {
  if (!name) return '';
  return name
    .replace(/['"״׳\-]/g, '')
    .replace(/בע"?מ|בעמ|ltd|llc|inc/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all suppliers
    const suppliers = await base44.asServiceRole.entities.Suppliers.filter({}, '-created_date', 1000);
    
    // Group by normalized VAT ID
    const vatGroups = {};
    const noVatSuppliers = [];
    
    for (const s of suppliers) {
      const normalizedVat = normalizeVatId(s.vat_id);
      if (normalizedVat) {
        if (!vatGroups[normalizedVat]) vatGroups[normalizedVat] = [];
        vatGroups[normalizedVat].push(s);
      } else {
        noVatSuppliers.push(s);
      }
    }
    
    const mergeLog = [];
    const deleteIds = [];
    
    // Merge suppliers with same VAT ID
    for (const [vatId, group] of Object.entries(vatGroups)) {
      if (group.length > 1) {
        // Keep the one with most data or oldest
        group.sort((a, b) => {
          // Prefer one with Hebrew name
          const aHebrew = /[\u0590-\u05FF]/.test(a.name || '');
          const bHebrew = /[\u0590-\u05FF]/.test(b.name || '');
          if (aHebrew && !bHebrew) return -1;
          if (!aHebrew && bHebrew) return 1;
          // Prefer older
          return new Date(a.created_date) - new Date(b.created_date);
        });
        
        const primary = group[0];
        const duplicates = group.slice(1);
        
        mergeLog.push({
          kept: { id: primary.id, name: primary.name, vat_id: primary.vat_id },
          merged: duplicates.map(d => ({ id: d.id, name: d.name }))
        });
        
        // Update all invoices pointing to duplicates
        for (const dup of duplicates) {
          const invoices = await base44.asServiceRole.entities.Invoices.filter({ supplier: dup.id });
          for (const inv of invoices) {
            await base44.asServiceRole.entities.Invoices.update(inv.id, { supplier: primary.id });
          }
          
          // Update invoice lines
          const lines = await base44.asServiceRole.entities.InvoiceLine.filter({ supplier_id: dup.id });
          for (const line of lines) {
            await base44.asServiceRole.entities.InvoiceLine.update(line.id, { supplier_id: primary.id });
          }
          
          // Update supplier product prices
          const prices = await base44.asServiceRole.entities.SupplierProductPrice.filter({ supplier_id: dup.id });
          for (const price of prices) {
            // Check if primary already has this SKU
            const existing = await base44.asServiceRole.entities.SupplierProductPrice.filter({ 
              supplier_id: primary.id, 
              sku: price.sku 
            });
            if (existing.length === 0) {
              await base44.asServiceRole.entities.SupplierProductPrice.update(price.id, { supplier_id: primary.id });
            } else {
              // Delete duplicate price record
              await base44.asServiceRole.entities.SupplierProductPrice.delete(price.id);
            }
          }
          
          // Update price alerts
          const alerts = await base44.asServiceRole.entities.PriceAlert.filter({ supplier_id: dup.id });
          for (const alert of alerts) {
            await base44.asServiceRole.entities.PriceAlert.update(alert.id, { supplier_id: primary.id });
          }
          
          // Update supplier patterns
          const patterns = await base44.asServiceRole.entities.SupplierPattern.filter({ supplier_id: dup.id });
          for (const pattern of patterns) {
            await base44.asServiceRole.entities.SupplierPattern.update(pattern.id, { supplier_id: primary.id });
          }
          
          deleteIds.push(dup.id);
        }
      }
    }
    
    // Try to match no-VAT suppliers to existing ones by name
    for (const noVat of noVatSuppliers) {
      const normalizedName = normalizeSupplierName(noVat.name);
      if (!normalizedName) continue;
      
      // Find a match by name
      let matchFound = null;
      for (const [vatId, group] of Object.entries(vatGroups)) {
        for (const s of group) {
          if (normalizeSupplierName(s.name) === normalizedName) {
            matchFound = group[0]; // Use the primary from the group
            break;
          }
        }
        if (matchFound) break;
      }
      
      if (matchFound && matchFound.id !== noVat.id) {
        mergeLog.push({
          kept: { id: matchFound.id, name: matchFound.name, vat_id: matchFound.vat_id },
          merged: [{ id: noVat.id, name: noVat.name, reason: 'name match, no vat_id' }]
        });
        
        // Update references
        const invoices = await base44.asServiceRole.entities.Invoices.filter({ supplier: noVat.id });
        for (const inv of invoices) {
          await base44.asServiceRole.entities.Invoices.update(inv.id, { supplier: matchFound.id });
        }
        
        const lines = await base44.asServiceRole.entities.InvoiceLine.filter({ supplier_id: noVat.id });
        for (const line of lines) {
          await base44.asServiceRole.entities.InvoiceLine.update(line.id, { supplier_id: matchFound.id });
        }
        
        deleteIds.push(noVat.id);
      }
    }
    
    // Delete duplicate suppliers
    for (const id of deleteIds) {
      await base44.asServiceRole.entities.Suppliers.delete(id);
    }
    
    return Response.json({
      success: true,
      suppliersProcessed: suppliers.length,
      duplicatesRemoved: deleteIds.length,
      mergeLog
    });
    
  } catch (error) {
    return Response.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
});