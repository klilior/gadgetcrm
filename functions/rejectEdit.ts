import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    
    try {
        const user = await base44.auth.me();
        if (!user || (user.role !== 'מנהל' && user.role !== 'מנהל משמרת')) {
            return Response.json({ success: false, error: 'אין הרשאה' }, { status: 403 });
        }

        const { edit_id, manager_comment } = await req.json();

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

        return Response.json({ 
            success: true,
            message: 'הבקשה נדחתה'
        });

    } catch (error) {
        console.error('Reject edit error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});