import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';
import { resolveActor } from '../../shared/actorResolver.ts';
import { resolveCorrelationId } from '../../shared/correlation.ts';
import { logAudit } from '../../shared/audit.ts';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me();
        if (!user || (user.role !== 'admin' && user.role !== 'מנהל' && user.role !== 'מנהל משמרת')) {
            return Response.json({ success: false, error: 'אין הרשאה' }, { status: 403 });
        }

        const { edit_id, manager_comment, correlation_id } = await req.json();
        const actor = await resolveActor(base44, { user });
        const correlationId = resolveCorrelationId(req, correlation_id, 'attendance_approve');

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

        await logAudit(base44, {
            actor_user_id: actor.authenticated_user_id,
            actor_employee_id: actor.employee_id,
            entity_type: 'AttendanceEdit',
            entity_id: edit.id,
            action: 'APPROVE',
            before_data: { status: edit.status, manager_comment: edit.manager_comment || null },
            after_data: { status: 'approved', manager_comment: manager_comment || 'אושר' },
            field_changes: { status: { before: edit.status, after: 'approved' } },
            source: 'USER',
            correlation_id: correlationId,
            request_context: { actor_type: actor.actor_type }
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