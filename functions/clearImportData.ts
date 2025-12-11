import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user.role !== 'מנהל' && user.role !== 'admin') {
            return Response.json({ error: 'רק מנהלים' }, { status: 403 });
        }

        console.log('🗑️ מוחק נתוני ייבוא...');

        // Delete all rows
        const rows = await base44.asServiceRole.entities.LineImportRow.list(null, 10000);
        console.log(`📊 ${rows.length} שורות למחיקה`);
        
        for (let i = 0; i < rows.length; i += 100) {
            const chunk = rows.slice(i, i + 100);
            for (const row of chunk) {
                await base44.asServiceRole.entities.LineImportRow.delete(row.id);
            }
            console.log(`✅ ${Math.min(i + 100, rows.length)}/${rows.length}`);
        }

        // Delete all batches
        const batches = await base44.asServiceRole.entities.LineImportBatch.list(null, 1000);
        console.log(`📦 ${batches.length} באצ'ים למחיקה`);
        
        for (const batch of batches) {
            await base44.asServiceRole.entities.LineImportBatch.delete(batch.id);
        }

        // Delete all product definitions
        const defs = await base44.asServiceRole.entities.LineProductDefinition.list(null, 10000);
        console.log(`🔧 ${defs.length} הגדרות מוצר למחיקה`);
        
        for (const def of defs) {
            await base44.asServiceRole.entities.LineProductDefinition.delete(def.id);
        }

        return Response.json({
            success: true,
            deleted: {
                rows: rows.length,
                batches: batches.length,
                definitions: defs.length
            },
            message: `✅ נמחקו ${rows.length} שורות, ${batches.length} באצ'ים, ${defs.length} הגדרות`
        });

    } catch (error) {
        console.error('❌', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});