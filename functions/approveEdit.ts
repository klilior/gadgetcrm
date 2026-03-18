import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me();
        if (!user || (user.role !== 'מנהל' && user.role !== 'מנהל משמרת')) {
            return Response.json({ success: false, error: 'אין הרשאה' }, { status: 403 });
        }

        const { edit_id, manager_comment } = await req.json();

        // Get the edit request
        const edit = await base44.asServiceRole.entities.AttendanceEdit.get(edit_id);
        
        if (!edit) {
            return Response.json({ success: false, error: 'בקשה לא נמצאה' }, { status: 404 });
        }

        if (edit.status !== 'pending') {
            return Response.json({ success: false, error: 'הבקשה כבר טופלה' }, { status: 400 });
        }

        // Get existing day data
        const existingDays = await base44.asServiceRole.entities.AttendanceDay.filter({
            user_id: edit.user_id,
            date: edit.date
        });

        const existingDay = existingDays[0];

        // Get all events for this day
        const events = await base44.asServiceRole.entities.AttendanceEvent.filter({
            user_id: edit.user_id,
            event_time: { $gte: `${edit.date}T00:00:00`, $lt: `${edit.date}T23:59:59` }
        }, 'event_time');

        // Update events based on requested change
        if (edit.requested_change?.first_in && events.length > 0) {
            const firstEvent = events.find(e => e.event_type === 'in');
            if (firstEvent) {
                const newTime = `${edit.date}T${edit.requested_change.first_in}:00`;
                await base44.asServiceRole.entities.AttendanceEvent.update(firstEvent.id, {
                    event_time: newTime,
                    notes: `עודכן ע"י מנהל: ${manager_comment || 'אושר'}`
                });
            }
        }

        if (edit.requested_change?.last_out && events.length > 0) {
            const lastOut = events.reverse().find(e => e.event_type === 'out' || e.event_type === 'auto_out');
            if (lastOut) {
                const newTime = `${edit.date}T${edit.requested_change.last_out}:00`;
                await base44.asServiceRole.entities.AttendanceEvent.update(lastOut.id, {
                    event_time: newTime,
                    event_type: 'out',
                    notes: `עודכן ע"י מנהל: ${manager_comment || 'אושר'}`
                });
            }
        }

        // Update the edit request status
        await base44.asServiceRole.entities.AttendanceEdit.update(edit_id, {
            status: 'approved',
            manager_comment: manager_comment || 'אושר',
            approver_id: user.id
        });

        // Trigger day recomputation
        await base44.asServiceRole.functions.invoke('computeDay', {
            user_id: edit.user_id,
            date: edit.date
        });

        return Response.json({ 
            success: true,
            message: 'הבקשה אושרה והנתונים עודכנו'
        });

    } catch (error) {
        console.error('Approve edit error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});