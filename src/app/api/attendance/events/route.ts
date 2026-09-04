import { NextRequest, NextResponse } from 'next/server';

import { requireApiPermission } from '@/lib/permissionGate';
import { can } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
    const value = new Date(`${date}T12:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
    const auth = await requireApiPermission({ moduleCode: 'finance', action: 'view' });
    if (!auth.ok) return auth.error;

    const requestedLimit = Number(new URL(request.url).searchParams.get('limit'));
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const params = new URL(request.url).searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = params.get('from') || addDays(today, -14);
    const toDate = params.get('to') || today;
    if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate) || fromDate > toDate
        || (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) > 31 * 86_400_000) {
        return NextResponse.json({ error: 'invalid_date_range' }, { status: 422 });
    }

    let supabase;
    try {
        supabase = getServerSupabase();
    } catch {
        return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    }

    const [eventsResult, summariesResult] = await Promise.all([
        supabase
            .from('attendance_events')
            .select('id, employee_external_no, occurred_at, direction, received_at, employee:employees(id, full_name)')
            .order('occurred_at', { ascending: false })
            .limit(limit),
        supabase
            .from('attendance_daily_summaries')
            .select('id, employee_id, work_date, attendance_class, payment_type, first_entry_at, last_exit_at, worked_minutes, break_minutes, payable_minutes, estimated_amount, late_minutes, early_departure_minutes, overtime_minutes, status, incidents, employee:employees(id, full_name)')
            .gte('work_date', fromDate)
            .lte('work_date', toDate)
            .order('work_date', { ascending: false }),
    ]);

    if (eventsResult.error || summariesResult.error) {
        console.error('Attendance events API: query failed.', {
            code: eventsResult.error?.code || summariesResult.error?.code,
        });
        return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    }

    const summaries = summariesResult.data || [];
    const summaryIds = summaries.map(summary => summary.id);
    let approvals: Array<{ attendance_summary_id: string; approved_minutes: number }> = [];
    if (summaryIds.length > 0) {
        const { data, error } = await supabase
            .from('attendance_overtime_approvals')
            .select('attendance_summary_id, approved_minutes')
            .in('attendance_summary_id', summaryIds);
        if (error) {
            console.error('Attendance approvals API: query failed.', { code: error.code });
            return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
        }
        approvals = (data || []) as typeof approvals;
    }
    const approvedBySummary = new Map(
        approvals.map(approval => [approval.attendance_summary_id, Number(approval.approved_minutes)]),
    );
    const canApprove = can(auth.session.role, auth.session.permissions, 'finance', 'edit', null);

    return NextResponse.json(
        {
            events: eventsResult.data || [],
            summaries: summaries.map(summary => ({
                ...summary,
                approved_overtime_minutes: approvedBySummary.get(summary.id) || 0,
            })),
            canApprove,
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
