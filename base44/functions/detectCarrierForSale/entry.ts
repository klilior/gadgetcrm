import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Detects carrier code for a sale/product
 * Priority: exact SKU → SKU prefix → name contains
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { sku, product_name } = await req.json();

        if (!sku && !product_name) {
            return Response.json({ carrier_code: null });
        }

        // Load all active mappings, sorted by priority
        const mappings = await base44.asServiceRole.entities.CarrierProductMapping
            .filter({ is_active: true }, '-priority', 200);

        // Try exact SKU match
        if (sku) {
            const exactMatch = mappings.find(m => m.product_sku_exact === sku);
            if (exactMatch) {
                return Response.json({ carrier_code: exactMatch.carrier_code, method: 'exact_sku' });
            }
        }

        // Try SKU prefix match
        if (sku) {
            const prefixMatch = mappings.find(m => 
                m.product_sku_prefix && sku.startsWith(m.product_sku_prefix)
            );
            if (prefixMatch) {
                return Response.json({ carrier_code: prefixMatch.carrier_code, method: 'sku_prefix' });
            }
        }

        // Try name contains
        if (product_name) {
            const nameMatch = mappings.find(m => 
                m.name_contains && product_name.toLowerCase().includes(m.name_contains.toLowerCase())
            );
            if (nameMatch) {
                return Response.json({ carrier_code: nameMatch.carrier_code, method: 'name_contains' });
            }
        }

        return Response.json({ carrier_code: null });

    } catch (error) {
        console.error("Error detecting carrier:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});