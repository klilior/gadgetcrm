import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format } from 'npm:date-fns@2.30.0';

/**
 * Daily job: Updates contracts to ELIGIBLE when safe_retarget_date is reached
 * Also clears expired snoozes
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const today = format(new Date(), 'yyyy-MM-dd');
        const now = new Date().toISOString();

        console.log(`🔄 Running eligibility update for date: ${today}`);

        // Find contracts that should become eligible
        const lockedContracts = await base44.asServiceRole.entities.LineContract
            .filter({
                status: { $in: ['LOCKED', 'ELIGIBLE'] },
                safe_retarget_date: { $lte: today }
            }, null, 1000);

        let updatedCount = 0;
        for (const contract of lockedContracts) {
            if (contract.status !== 'ELIGIBLE') {
                await base44.asServiceRole.entities.LineContract.update(contract.id, {
                    status: 'ELIGIBLE'
                });
                updatedCount++;
            }
        }

        console.log(`✅ Updated ${updatedCount} contracts to ELIGIBLE`);

        // Clear expired snoozes
        const snoozedContracts = await base44.asServiceRole.entities.LineContract
            .filter({
                status: 'IN_PROGRESS',
                snooze_until: { $lte: now }
            }, null, 500);

        let clearedSnoozes = 0;
        for (const contract of snoozedContracts) {
            await base44.asServiceRole.entities.LineContract.update(contract.id, {
                snooze_until: null
            });
            clearedSnoozes++;
        }

        console.log(`✅ Cleared ${clearedSnoozes} expired snoozes`);

        return Response.json({ 
            success: true, 
            updated: updatedCount,
            snoozesCleared: clearedSnoozes,
            message: `עודכנו ${updatedCount} חוזים ל-ELIGIBLE, נוקו ${clearedSnoozes} נודניקים`
        });

    } catch (error) {
        console.error("Error updating eligibility:", error);
        return Response.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
});