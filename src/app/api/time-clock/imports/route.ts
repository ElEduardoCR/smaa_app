import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requireApiPermission } from '@/lib/permissionGate';
import { getServerSupabase } from '@/lib/supabaseServer';
import {
    interpretTimeClockFile,
    MAX_TIME_CLOCK_FILE_BYTES,
    mergeTimeClockMarks,
    type NormalizedTimeClockRecord,
    type TimeClockFileExtension,
} from '@/lib/timeClockImport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REQUEST_BYTES = MAX_TIME_CLOCK_FILE_BYTES + 64 * 1024;

type PayrollEmployee = {
    employee_id: string;
    code: string;
    full_name: string;
    status: string;
    is_active: boolean;
};

type DailyRecord = {
    id: string;
    employee_id: string;
    employee_code: string;
    work_date: string;
    check_in: string | null;
    check_out: string | null;
    worked_minutes: number;
};

function addDays(date: string, days: number): string {
    const value = new Date(`${date}T12:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function startOfWeek(date: string): string {
    const value = new Date(`${date}T12:00:00.000Z`);
    const day = value.getUTCDay();
    value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
    return value.toISOString().slice(0, 10);
}

function safeFileName(value: string): string {
    return value
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function fileExtension(name: string): TimeClockFileExtension | null {
    const extension = name.toLowerCase().split('.').pop();
    return extension === 'xls' || extension === 'xlsx' || extension === 'csv' || extension === 'txt'
        ? extension
        : null;
}

function chunks<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
    return result;
}

async function loadPayrollEmployees(codes?: string[]): Promise<PayrollEmployee[]> {
    const db = getServerSupabase();
    if (!codes) {
        const { data, error } = await db
            .from('v_payroll_employees')
            .select('employee_id, code, full_name, status, is_active')
            .eq('status', 'active')
            .eq('is_active', true)
            .order('full_name', { ascending: true });
        if (error) throw error;
        return (data || []) as PayrollEmployee[];
    }

    const employees: PayrollEmployee[] = [];
    for (const codeChunk of chunks(codes, 100)) {
        const { data, error } = await db
            .from('v_payroll_employees')
            .select('employee_id, code, full_name, status, is_active')
            .in('code', codeChunk);
        if (error) throw error;
        employees.push(...((data || []) as PayrollEmployee[]));
    }
    return employees;
}

async function loadExistingRecords(employeeIds: string[], fromDate: string, toDate: string): Promise<DailyRecord[]> {
    const db = getServerSupabase();
    const records: DailyRecord[] = [];
    for (const employeeChunk of chunks(employeeIds, 100)) {
        const { data, error } = await db
            .from('time_clock_daily_records')
            .select('id, employee_id, employee_code, work_date, check_in, check_out, worked_minutes')
            .in('employee_id', employeeChunk)
            .gte('work_date', fromDate)
            .lte('work_date', toDate);
        if (error) throw error;
        records.push(...((data || []) as DailyRecord[]));
    }
    return records;
}

function aiStatus() {
    const requested = (process.env.TIME_CLOCK_AI_PROVIDER || 'deterministic').toLowerCase();
    const model = process.env.DEEPSEEK_ATTENDANCE_MODEL || '';
    const configured = requested === 'deepseek'
        && Boolean(process.env.DEEPSEEK_API_KEY)
        && Boolean(model);
    return {
        provider: configured ? 'deepseek' : 'deterministic',
        configured,
        model: configured ? model : null,
        thinking: configured,
        reasoningEffort: configured ? 'high' : null,
    };
}

export async function GET(request: NextRequest) {
    const auth = await requireApiPermission({ moduleCode: 'finance', action: 'view' });
    if (!auth.ok) return auth.error;

    const requestedWeek = new URL(request.url).searchParams.get('week') || new Date().toISOString().slice(0, 10);
    if (!DATE_PATTERN.test(requestedWeek)) {
        return NextResponse.json({ error: 'invalid_week' }, { status: 422 });
    }
    const weekStart = startOfWeek(requestedWeek);
    const weekEnd = addDays(weekStart, 6);

    try {
        const db = getServerSupabase();
        const [employees, recordsResult, uploadsResult, latestResult] = await Promise.all([
            loadPayrollEmployees(),
            db
                .from('time_clock_daily_records')
                .select('id, employee_id, employee_code, work_date, check_in, check_out, worked_minutes')
                .gte('work_date', weekStart)
                .lte('work_date', weekEnd)
                .order('work_date', { ascending: true }),
            db
                .from('time_clock_uploads')
                .select('id, file_name, period_start, period_end, format, status, rows_total, rows_parsed, rows_unmatched, rows_inserted, rows_updated, rows_unchanged, rows_conflicted, uploaded_at, interpreter')
                .order('uploaded_at', { ascending: false })
                .limit(8),
            db
                .from('time_clock_daily_records')
                .select('work_date')
                .order('work_date', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);
        if (recordsResult.error || uploadsResult.error || latestResult.error) {
            throw recordsResult.error || uploadsResult.error || latestResult.error;
        }

        return NextResponse.json({
            weekStart,
            weekEnd,
            employees: employees.map((employee) => ({
                employeeId: employee.employee_id,
                code: employee.code,
                fullName: employee.full_name,
            })),
            records: (recordsResult.data || []).map((record) => ({
                id: record.id,
                employeeId: record.employee_id,
                employeeCode: record.employee_code,
                workDate: record.work_date,
                checkIn: record.check_in,
                checkOut: record.check_out,
                workedMinutes: Number(record.worked_minutes || 0),
            })),
            uploads: uploadsResult.data || [],
            latestRecordedDate: latestResult.data?.work_date || null,
            ai: aiStatus(),
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('Time clock weekly query failed.', {
            code: typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown',
        });
        return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    }
}

function preparePreview(
    parsedRecords: NormalizedTimeClockRecord[],
    employees: PayrollEmployee[],
    existingRecords: DailyRecord[],
) {
    const employeeByCode = new Map(
        employees
            .filter((employee) => employee.status === 'active' && employee.is_active)
            .map((employee) => [employee.code, employee]),
    );
    const existingByKey = new Map(existingRecords.map((record) => [`${record.employee_id}|${record.work_date}`, record]));
    const unmatchedCodes = new Set<string>();
    const persistable: Array<NormalizedTimeClockRecord & { employeeId: string }> = [];

    const rows = parsedRecords.map((record) => {
        const employee = employeeByCode.get(record.employeeCode);
        if (!employee) {
            unmatchedCodes.add(record.employeeCode);
            return {
                ...record,
                employeeName: null,
                action: 'unmatched' as const,
                workedMinutes: 0,
            };
        }

        const existing = existingByKey.get(`${employee.employee_id}|${record.workDate}`);
        const merged = mergeTimeClockMarks(
            existing ? { checkIn: existing.check_in, checkOut: existing.check_out } : null,
            record,
        );
        const action = merged.conflict || merged.durationInvalid
            ? 'conflict'
            : !existing
                ? 'insert'
                : merged.changed
                    ? 'complete'
                    : 'unchanged';

        if (!merged.durationInvalid) persistable.push({ ...record, employeeId: employee.employee_id });

        return {
            employeeCode: record.employeeCode,
            employeeName: employee.full_name,
            workDate: record.workDate,
            checkIn: merged.checkIn,
            checkOut: merged.checkOut,
            workedMinutes: merged.workedMinutes,
            action,
        };
    });

    return {
        rows,
        persistable,
        unmatchedCodes: [...unmatchedCodes].slice(0, 50),
        unmatchedCount: rows.filter((row) => row.action === 'unmatched').length,
        conflictCount: rows.filter((row) => row.action === 'conflict').length,
    };
}

export async function POST(request: NextRequest) {
    const auth = await requireApiPermission({ moduleCode: 'finance', action: 'edit' });
    if (!auth.ok) return auth.error;

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
        return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }

    try {
        const formData = await request.formData();
        const mode = formData.get('mode');
        const file = formData.get('file');
        if ((mode !== 'preview' && mode !== 'commit') || !(file instanceof File)) {
            return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
        }
        if (file.size === 0 || file.size > MAX_TIME_CLOCK_FILE_BYTES) {
            return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
        }

        const fileName = safeFileName(file.name);
        const extension = fileExtension(fileName);
        if (!fileName || !extension) {
            return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const checksum = createHash('sha256').update(buffer).digest('hex');
        const parsed = await interpretTimeClockFile(buffer, extension);
        const codes = [...new Set(parsed.records.map((record) => record.employeeCode))];
        if (codes.length > 1_000) {
            return NextResponse.json({ error: 'too_many_employees' }, { status: 422 });
        }
        const employees = await loadPayrollEmployees(codes);
        const employeeIds = employees.map((employee) => employee.employee_id);
        const fromDate = parsed.records[0].workDate;
        const toDate = parsed.records[parsed.records.length - 1].workDate;
        const existing = employeeIds.length > 0
            ? await loadExistingRecords(employeeIds, fromDate, toDate)
            : [];
        const preview = preparePreview(parsed.records, employees, existing);

        if (mode === 'preview') {
            return NextResponse.json({
                fileName,
                rowsTotal: parsed.rowsTotal,
                rowsDetected: parsed.records.length,
                rowsReady: preview.persistable.length,
                unmatchedCount: preview.unmatchedCount,
                unmatchedCodes: preview.unmatchedCodes,
                conflictCount: preview.conflictCount,
                warnings: parsed.warnings.slice(0, 50),
                interpreter: parsed.interpreter,
                sheetRoles: parsed.sheetRoles,
                periodStart: fromDate,
                periodEnd: toDate,
                records: preview.rows.slice(0, 500),
            });
        }

        const recordsToApply = preview.persistable.filter((record) =>
            employees.some((employee) => employee.employee_id === record.employeeId));
        if (recordsToApply.length === 0) {
            return NextResponse.json({ error: 'no_matching_records' }, { status: 422 });
        }

        const db = getServerSupabase();
        const { data, error } = await db.rpc('apply_time_clock_import', {
            p_file_name: fileName,
            p_file_format: extension,
            p_source_checksum: checksum,
            p_interpreter: parsed.interpreter,
            p_rows_total: parsed.rowsTotal,
            p_rows_unmatched: preview.unmatchedCount,
            p_uploaded_by: auth.session.employeeId,
            p_records: recordsToApply.map((record) => ({
                employee_id: record.employeeId,
                employee_code: record.employeeCode,
                work_date: record.workDate,
                check_in: record.checkIn || '',
                check_out: record.checkOut || '',
            })),
        });
        if (error) throw error;

        return NextResponse.json({
            ok: true,
            result: data,
            unmatchedCount: preview.unmatchedCount,
            warningsCount: parsed.warnings.length,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.startsWith('El archivo') || message.startsWith('No pude')) {
            return NextResponse.json({ error: 'invalid_spreadsheet', message }, { status: 422 });
        }
        console.error('Time clock import failed.', {
            code: typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown',
            name: error instanceof Error ? error.name : 'unknown',
        });
        return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
    }
}
