import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        // Strict Role Check
        if (!user || (user.role !== 'מנהל' && user.role !== 'admin')) {
            return Response.json({ error: 'Unauthorized: Only managers can delete all data' }, { status: 403 });
        }

        console.log(`🗑️ Delete All Sales Data requested by ${user.email}`);

        let totalDeleted = 0;
        let hasMore = true;
        const startTime = Date.now();
        const MAX_EXECUTION_TIME = 25000; // 25 seconds safety limit

        while (hasMore) {
            // Check time limit
            if (Date.now() - startTime > MAX_EXECUTION_TIME) {
                console.log(`⚠️ Time limit reached. Deleted ${totalDeleted} so far.`);
                return Response.json({ 
                    success: true, 
                    partial: true, 
                    count: totalDeleted,
                    message: "Time limit reached. Please click delete again to continue."
                });
            }

            // Fetch in moderate batches to prevent rate limits/timeouts
            const items = await base44.asServiceRole.entities.SalesTransaction.list(null, 50);
            
            if (!items || items.length === 0) {
                hasMore = false;
                break;
            }

            console.log(`Deleting batch of ${items.length} records...`);
            
            // Execute deletes safely
            const results = await Promise.all(items.map(async (item) => {
                try {
                    await base44.asServiceRole.entities.SalesTransaction.delete(item.id);
                    return true;
                } catch (err) {
                    console.error(`Failed to delete item ${item.id}:`, err);
                    return false;
                }
            }));
            
            const deletedCount = results.filter(r => r).length;
            totalDeleted += deletedCount;

            // If we failed to delete any item in this batch, break to avoid infinite loop
            if (deletedCount === 0 && items.length > 0) {
                console.error("Stuck: Failed to delete any items in the current batch. Aborting.");
                throw new Error("Failed to delete records. Please try again.");
            }
        }

        console.log(`✅ Successfully deleted ${totalDeleted} records`);

        return Response.json({ success: true, partial: false, count: totalDeleted });

    } catch (error) {
        console.error("❌ Delete Error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});