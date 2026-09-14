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
        const correlationId = resolveCorrelationId(req, correlation_id, 'attendance_reject');

        if (!manager_comment || !manager_comment.trim()) {
            return Response.json({ success: false, error: 'חובה להזין סיבה לדחייה' }, { status: 400 });
        }

        // Get the edit request
        const edit = await base44.asServiceRole.entities.AttendanceEdit.get(edit_id);
        
        if (!edit) {
            return Response.json({ success: false, error: 'בקשה לא נמצאה' }, { status: 404 });
        }

        if (edit.status !== 'pending') {
            return Response.json({ success: false, error: 'הבקשה כבר טופלה' }, { status: 400 });
        }

        // Update the edit request status
        await base44.asServiceRole.entities.AttendanceEdit.update(edit_id, {
            status: 'rejected',
            manager_comment: manager_comment,
            approver_id: user.id
        });

        await logAudit(base44, {
            actor_user_id: actor.authenticated_user_id,
            actor_employee_id: actor.employee_id,
            entity_type: 'AttendanceEdit',
            entity_id: edit.id,
            action: 'REJECT',
            before_data: { status: edit.status, manager_comment: edit.manager_comment || null },
            after_data: { status: 'rejected', manager_comment },
            field_changes: { status: { before: edit.status, after: 'rejected' } },
            source: 'USER',
            correlation_id: correlationId,
            request_context: { actor_type: actor.actor_type }
        });

        return Response.json({ 
            success: true,
            message: 'הבקשה נדחתה'
        });

    } catch (error) {
        console.error('Reject edit error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});