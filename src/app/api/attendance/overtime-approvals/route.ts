import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireApiPermission } from '@/lib/permissionGate';
import { getServerSupabase } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const approvalSchema = z.object({
    summaryId: z.string().uuid(),
    approvedMinutes: z.number().int().positive().max(24 * 60),
    notes: z.string().trim().max(500).optional(),
}).strict();

export async function POST(request: NextRequest) {
    const auth = await requireApiPermission({ moduleCode: 'finance', action: 'edit' });
    if (!auth.ok) return auth.error;

    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const parsed = approvalSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'invalid_approval' }, { status: 422 });

    let db;
    try {
        db = getServerSupabase();
    } catch {
        return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    }

    const { data: summary, error: summaryError } = await db
        .from('attendance_daily_summaries')
        .select('id, employee_id, work_date, attendance_class, overtime_minutes')
        .eq('id', parsed.data.summaryId)
        .maybeSingle();
    if (summaryError) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    if (!summary) return NextResponse.json({ error: 'summary_not_found' }, { status: 404 });
    if (summary.attendance_class !== 'scheduled'
        || parsed.data.approvedMinutes > Number(summary.overtime_minutes)) {
        return NextResponse.json({ error: 'invalid_approval' }, { status: 422 });
    }

    const { data: existing, error: existingError } = await db
        .from('attendance_overtime_approvals')
        .select('id')
        .eq('attendance_summary_id', summary.id)
        .maybeSingle();
    if (existingError) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });

    const values = {
        employee_id: summary.employee_id,
        work_date: summary.work_date,
        attendance_summary_id: summary.id,
        time_clock_entry_id: null,
        approved_minutes: parsed.data.approvedMinutes,
        approved_by: auth.session.employeeId,
        approved_at: new Date().toISOString(),
        notes: parsed.data.notes || null,
    };
    const query = existing
        ? db.from('attendance_overtime_approvals').update(values).eq('id', existing.id)
        : db.from('attendance_overtime_approvals').insert(values);
    const { error } = await query;
    if (error) {
        console.error('Attendance overtime approval failed.', { code: error.code });
        return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    }

    return NextResponse.json({ ok: true, approvedMinutes: parsed.data.approvedMinutes });
}
