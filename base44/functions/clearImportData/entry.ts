import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ error: 'רק מנהלים' }, { status: 403 });
        }

        console.log('🗑️ מוחק נתוני ייבוא...');

        let rowsDeleted = 0, batchesDeleted = 0, defsDeleted = 0;

        // Delete all product definitions first (smaller table)
        try {
            const defs = await base44.asServiceRole.entities.LineProductDefinition.list(null, 1000);
            console.log(`🔧 ${defs.length} הגדרות מוצר למחיקה`);
            for (const def of defs) {
                await base44.asServiceRole.entities.LineProductDefinition.delete(def.id);
                defsDeleted++;
            }
        } catch (e) {
            console.error('Error deleting definitions:', e);
        }

        // Delete rows in smaller batches
        try {
            let hasMore = true;
            while (hasMore) {
                const rows = await base44.asServiceRole.entities.LineImportRow.list(null, 100);
                if (rows.length === 0) {
                    hasMore = false;
                } else {
                    for (const row of rows) {
                        await base44.asServiceRole.entities.LineImportRow.delete(row.id);
                        rowsDeleted++;
                    }
                    console.log(`✅ נמחקו ${rowsDeleted} שורות...`);
                }
            }
        } catch (e) {
            console.error('Error deleting rows:', e);
        }

        // Delete batches last
        try {
            const batches = await base44.asServiceRole.entities.LineImportBatch.list(null, 100);
            console.log(`📦 ${batches.length} באצ'ים למחיקה`);
            for (const batch of batches) {
                await base44.asServiceRole.entities.LineImportBatch.delete(batch.id);
                batchesDeleted++;
            }
        } catch (e) {
            console.error('Error deleting batches:', e);
        }

        return Response.json({
            success: true,
            deleted: {
                rows: rowsDeleted,
                batches: batchesDeleted,
                definitions: defsDeleted
            },
            message: `✅ נמחקו ${rowsDeleted} שורות, ${batchesDeleted} באצ'ים, ${defsDeleted} הגדרות`
        });

    } catch (error) {
        console.error('❌', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});