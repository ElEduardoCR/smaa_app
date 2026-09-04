import { NextRequest, NextResponse } from 'next/server';

import { recalculateAttendanceRange } from '@/lib/attendanceService';
import { requireApiPermission } from '@/lib/permissionGate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validRange(fromDate: string, toDate: string): boolean {
    if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate) || fromDate > toDate) return false;
    const days = Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
    return Number.isFinite(days) && days >= 0 && days <= 31;
}

export async function POST(request: NextRequest) {
    const auth = await requireApiPermission({ moduleCode: 'finance', action: 'view' });
    if (!auth.ok) return auth.error;

    let input: { fromDate?: unknown; toDate?: unknown };
    try {
        input = await request.json();
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const fromDate = typeof input.fromDate === 'string' ? input.fromDate : '';
    const toDate = typeof input.toDate === 'string' ? input.toDate : '';
    if (!validRange(fromDate, toDate)) {
        return NextResponse.json({ error: 'invalid_date_range' }, { status: 422 });
    }

    try {
        const result = await recalculateAttendanceRange({ fromDate, toDate });
        return NextResponse.json({ ok: true, summaries: result.summaries });
    } catch (error) {
        console.error('Attendance recalculation failed.', {
            code: error instanceof Error ? error.name : 'unknown',
        });
        return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    }
}
