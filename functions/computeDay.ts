import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const { user_id, date } = await req.json();
        
        if (!user_id || !date) {
            return Response.json({ success: false, error: 'חסרים פרמטרים' }, { status: 400 });
        }

        // Get all events for this day
        const events = await base44.asServiceRole.entities.AttendanceEvent.filter({
            user_id,
            event_time: { $gte: `${date}T00:00:00`, $lt: `${date}T23:59:59` }
        }, 'event_time');

        if (events.length === 0) {
            return Response.json({ success: true, message: 'אין אירועים ליום זה' });
        }

        // Get overtime rules
        const rules = await base44.asServiceRole.entities.OvertimeRule.filter({ scope: 'org' }, '-effective_from');
        const rule = rules[0] || {
            daily_regular_minutes: 480,
            daily_first_tier_minutes: 120,
            first_tier_multiplier: 1.25,
            second_tier_multiplier: 1.5,
            unpaid_break_after_minutes: 360,
            unpaid_break_length: 30
        };

        // Calculate work time
        let totalWorkMinutes = 0;
        let breaks_minutes = 0;
        let first_in = null;
        let last_out = null;
        let status = 'ok';

        // Sort events by time
        events.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

        let currentIn = null;
        for (const event of events) {
            if (event.event_type === 'in') {
                currentIn = new Date(event.event_time);
                if (!first_in) first_in = event.event_time;
            } else if (event.event_type === 'out' || event.event_type === 'auto_out') {
                if (currentIn) {
                    const out = new Date(event.event_time);
                    const minutes = Math.floor((out - currentIn) / 60000);
                    totalWorkMinutes += minutes;
                    last_out = event.event_time;
                    currentIn = null;
                    
                    if (event.event_type === 'auto_out') {
                        status = 'missing_out';
                    }
                }
            }
        }

        // If still clocked in at end of day
        if (currentIn && !last_out) {
            status = 'pending_fix';
        }

        // Calculate unpaid break
        if (totalWorkMinutes > rule.unpaid_break_after_minutes) {
            breaks_minutes = rule.unpaid_break_length;
            totalWorkMinutes -= breaks_minutes;
        }

        // Calculate overtime
        let work_minutes = 0;
        let overtime125_minutes = 0;
        let overtime150_minutes = 0;

        if (totalWorkMinutes <= rule.daily_regular_minutes) {
            work_minutes = totalWorkMinutes;
        } else if (totalWorkMinutes <= rule.daily_regular_minutes + rule.daily_first_tier_minutes) {
            work_minutes = rule.daily_regular_minutes;
            overtime125_minutes = totalWorkMinutes - rule.daily_regular_minutes;
        } else {
            work_minutes = rule.daily_regular_minutes;
            overtime125_minutes = rule.daily_first_tier_minutes;
            overtime150_minutes = totalWorkMinutes - rule.daily_regular_minutes - rule.daily_first_tier_minutes;
        }

        // Update or create day record
        const existingDay = await base44.asServiceRole.entities.AttendanceDay.filter({ user_id, date });
        
        const dayData = {
            user_id,
            date,
            work_minutes,
            overtime125_minutes,
            overtime150_minutes,
            breaks_minutes,
            status,
            first_in: first_in ? new Date(first_in).toISOString().split('T')[1].substr(0, 5) : null,
            last_out: last_out ? new Date(last_out).toISOString().split('T')[1].substr(0, 5) : null,
            calc_version: (existingDay[0]?.calc_version || 0) + 1
        };

        if (existingDay.length > 0) {
            await base44.asServiceRole.entities.AttendanceDay.update(existingDay[0].id, dayData);
        } else {
            await base44.asServiceRole.entities.AttendanceDay.create(dayData);
        }

        return Response.json({ 
            success: true, 
            dayData,
            message: 'יום חושב בהצלחה'
        });

    } catch (error) {
        console.error('Compute day error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});