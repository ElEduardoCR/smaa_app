import 'server-only';

import {
    calculateHourlyAttendance,
    calculateScheduledAttendance,
    localDateForInstant,
    scheduleWindow,
    type AttendanceEventForCalculation,
    type AttendanceScheduleForCalculation,
} from '@/lib/attendanceCalculation';
import { getServerSupabase } from '@/lib/supabaseServer';

type PayrollRow = {
    employee_id: string;
    payment_type: string | null;
    hourly_rate: number | string | null;
    status: string | null;
};

type ScheduleRow = {
    id: string;
    timezone: string;
    start_time: string;
    end_time: string;
    work_days: number[];
    late_tolerance_minutes: number;
    early_departure_tolerance_minutes: number;
    overtime_threshold_minutes: number;
    active: boolean;
};

type AssignmentRow = {
    employee_id: string;
    schedule_id: string;
    effective_from: string;
    effective_to: string | null;
};

type RawEventRow = {
    id: string;
    employee_id: string;
    device_id: string;
    event_serial: string;
    occurred_at: string;
    direction: 'entry' | 'exit' | 'break_start' | 'break_end';
};

type Policy = {
    timezone: string;
    max_shift_minutes: number;
    calculation_version: number;
};

export type RecalculationResult = {
    fromDate: string;
    toDate: string;
    summaries: number;
};

function addDays(date: string, days: number): string {
    const value = new Date(`${date}T12:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function datesBetween(fromDate: string, toDate: string): string[] {
    const dates: string[] = [];
    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) dates.push(date);
    return dates;
}

function normalizeSchedule(row: ScheduleRow): AttendanceScheduleForCalculation {
    return {
        id: row.id,
        timezone: row.timezone,
        startTime: row.start_time.slice(0, 8),
        endTime: row.end_time.slice(0, 8),
        workDays: row.work_days.map(Number),
        lateToleranceMinutes: Number(row.late_tolerance_minutes),
        earlyDepartureToleranceMinutes: Number(row.early_departure_tolerance_minutes),
        overtimeThresholdMinutes: Number(row.overtime_threshold_minutes),
    };
}

function selectSchedule(
    employeeId: string,
    workDate: string,
    assignments: AssignmentRow[],
    schedules: Map<string, AttendanceScheduleForCalculation>,
): { schedule: AttendanceScheduleForCalculation | null; ambiguous: boolean } {
    const matches = assignments.filter(assignment =>
        assignment.employee_id === employeeId
        && assignment.effective_from <= workDate
        && (!assignment.effective_to || assignment.effective_to >= workDate)
        && schedules.has(assignment.schedule_id));
    if (matches.length !== 1) return { schedule: null, ambiguous: matches.length > 1 };
    return { schedule: schedules.get(matches[0].schedule_id) || null, ambiguous: false };
}

function toCalculationEvent(row: RawEventRow): AttendanceEventForCalculation {
    return {
        id: row.id,
        deviceId: row.device_id,
        eventSerial: row.event_serial,
        occurredAt: row.occurred_at,
        direction: row.direction,
    };
}

/**
 * Asigna explícitamente una secuencia por hora a la fecha de su entrada.
 * Una salida sin entrada conserva su propia fecha y queda como incidencia.
 */
function groupHourlyEvents(events: RawEventRow[], timezone: string): Map<string, RawEventRow[]> {
    const grouped = new Map<string, RawEventRow[]>();
    let openDate: string | null = null;

    for (const event of [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))) {
        const localDate = localDateForInstant(event.occurred_at, timezone);
        if (event.direction === 'entry' && !openDate) openDate = localDate;
        const workDate = openDate || localDate;
        const bucket = grouped.get(workDate) || [];
        bucket.push(event);
        grouped.set(workDate, bucket);
        if (event.direction === 'exit' && openDate) openDate = null;
    }

    return grouped;
}

function groupScheduledEvents(
    employeeId: string,
    events: RawEventRow[],
    policyTimezone: string,
    assignments: AssignmentRow[],
    schedules: Map<string, AttendanceScheduleForCalculation>,
): Map<string, RawEventRow[]> {
    const grouped = new Map<string, RawEventRow[]>();

    for (const event of events) {
        const localDate = localDateForInstant(event.occurred_at, policyTimezone);
        const previousDate = addDays(localDate, -1);
        const previous = selectSchedule(employeeId, previousDate, assignments, schedules);
        let workDate = localDate;

        // La única reasignación entre fechas permitida es un turno nocturno
        // explícito cuyo fin cae en la fecha civil del evento.
        if (previous.schedule) {
            const previousWindow = scheduleWindow(previousDate, previous.schedule);
            const instant = new Date(event.occurred_at);
            const isOvernight = previousWindow.end.toISOString().slice(0, 10)
                !== previousWindow.start.toISOString().slice(0, 10)
                || previous.schedule.endTime <= previous.schedule.startTime;
            if (isOvernight && instant >= previousWindow.start && instant <= previousWindow.end) {
                workDate = previousDate;
            }
        }

        const bucket = grouped.get(workDate) || [];
        bucket.push(event);
        grouped.set(workDate, bucket);
    }

    return grouped;
}

export async function recalculateAttendanceRange(input: {
    fromDate: string;
    toDate: string;
    employeeIds?: string[];
    now?: Date;
}): Promise<RecalculationResult> {
    const db = getServerSupabase();
    const now = input.now || new Date();

    const { data: policyRow, error: policyError } = await db
        .from('attendance_policies')
        .select('timezone, max_shift_minutes, calculation_version')
        .eq('id', true)
        .single();
    if (policyError) throw policyError;
    const policy = policyRow as Policy;

    let payrollQuery = db
        .from('payroll_employees')
        .select('employee_id, payment_type, hourly_rate, status')
        .eq('status', 'active')
        .not('employee_id', 'is', null);
    if (input.employeeIds?.length) payrollQuery = payrollQuery.in('employee_id', input.employeeIds);
    const { data: payrollData, error: payrollError } = await payrollQuery;
    if (payrollError) throw payrollError;

    const payrollRows = (payrollData || []) as PayrollRow[];
    const employeeIds = payrollRows.map(row => row.employee_id);
    if (employeeIds.length === 0) return { ...input, summaries: 0 };

    const [{ data: employees, error: employeeError }, scheduleResult, assignmentResult] = await Promise.all([
        db.from('employees').select('id, is_active').in('id', employeeIds),
        db.from('attendance_schedules').select('*').eq('active', true),
        db.from('employee_attendance_schedules')
            .select('employee_id, schedule_id, effective_from, effective_to')
            .in('employee_id', employeeIds)
            .lte('effective_from', input.toDate)
            .or(`effective_to.is.null,effective_to.gte.${input.fromDate}`),
    ]);
    if (employeeError) throw employeeError;
    if (scheduleResult.error) throw scheduleResult.error;
    if (assignmentResult.error) throw assignmentResult.error;

    const activeIds = new Set((employees || []).filter(row => row.is_active).map(row => row.id));
    const activePayroll = payrollRows.filter(row => activeIds.has(row.employee_id));
    const activeEmployeeIds = activePayroll.map(row => row.employee_id);
    if (activeEmployeeIds.length === 0) return { ...input, summaries: 0 };

    const schedules = new Map<string, AttendanceScheduleForCalculation>(
        ((scheduleResult.data || []) as ScheduleRow[]).map(row => [row.id, normalizeSchedule(row)]),
    );
    const assignments = (assignmentResult.data || []) as AssignmentRow[];

    // Incluye un día a cada lado para entradas tempranas y turnos nocturnos.
    const eventFrom = `${addDays(input.fromDate, -1)}T00:00:00.000Z`;
    const eventTo = `${addDays(input.toDate, 2)}T00:00:00.000Z`;
    const { data: eventData, error: eventError } = await db
        .from('attendance_events')
        .select('id, employee_id, device_id, event_serial, occurred_at, direction')
        .in('employee_id', activeEmployeeIds)
        .gte('occurred_at', eventFrom)
        .lt('occurred_at', eventTo)
        .order('occurred_at', { ascending: true });
    if (eventError) throw eventError;

    const eventsByEmployee = new Map<string, RawEventRow[]>();
    for (const event of (eventData || []) as RawEventRow[]) {
        const bucket = eventsByEmployee.get(event.employee_id) || [];
        bucket.push(event);
        eventsByEmployee.set(event.employee_id, bucket);
    }

    const rows: Record<string, unknown>[] = [];
    for (const payroll of activePayroll) {
        const employeeEvents = eventsByEmployee.get(payroll.employee_id) || [];
        const hourly = payroll.payment_type === 'hourly';
        const grouped = hourly
            ? groupHourlyEvents(employeeEvents, policy.timezone)
            : groupScheduledEvents(payroll.employee_id, employeeEvents, policy.timezone, assignments, schedules);

        for (const workDate of datesBetween(input.fromDate, input.toDate)) {
            const events = (grouped.get(workDate) || []).map(toCalculationEvent);
            if (hourly && events.length === 0) continue;

            const selection = selectSchedule(payroll.employee_id, workDate, assignments, schedules);
            const calculation = hourly
                ? calculateHourlyAttendance({
                    events,
                    hourlyRate: Number(payroll.hourly_rate) || null,
                    maxShiftMinutes: Number(policy.max_shift_minutes),
                })
                : calculateScheduledAttendance({
                    workDate,
                    events,
                    schedule: selection.schedule,
                    now,
                    maxShiftMinutes: Number(policy.max_shift_minutes),
                });
            const incidents = selection.ambiguous
                ? [...new Set([...calculation.incidents, 'schedule_ambiguous'])]
                : calculation.incidents;

            rows.push({
                employee_id: payroll.employee_id,
                work_date: workDate,
                attendance_class: hourly ? 'hourly' : 'scheduled',
                payment_type: payroll.payment_type || 'monthly',
                schedule_id: hourly ? null : selection.schedule?.id || null,
                scheduled_start_at: calculation.scheduledStartAt,
                scheduled_end_at: calculation.scheduledEndAt,
                first_entry_at: calculation.firstEntryAt,
                last_exit_at: calculation.lastExitAt,
                worked_minutes: calculation.workedMinutes,
                break_minutes: calculation.breakMinutes,
                payable_minutes: calculation.payableMinutes,
                hourly_rate: hourly ? (Number(payroll.hourly_rate) || null) : null,
                estimated_amount: calculation.estimatedAmount,
                late_minutes: calculation.lateMinutes,
                early_departure_minutes: calculation.earlyDepartureMinutes,
                overtime_minutes: calculation.overtimeMinutes,
                status: selection.ambiguous ? 'review_required' : calculation.status,
                incidents,
                source_event_count: calculation.sourceEventCount,
                calculation_version: Number(policy.calculation_version),
                calculated_at: now.toISOString(),
            });
        }
    }

    if (rows.length > 0) {
        const { error } = await db
            .from('attendance_daily_summaries')
            .upsert(rows, { onConflict: 'employee_id,work_date' });
        if (error) throw error;
    }

    return { fromDate: input.fromDate, toDate: input.toDate, summaries: rows.length };
}

export async function recalculateAttendanceForEvent(employeeId: string, occurredAt: string): Promise<void> {
    const db = getServerSupabase();
    const { data, error } = await db
        .from('attendance_policies')
        .select('timezone')
        .eq('id', true)
        .single();
    if (error) throw error;
    const date = localDateForInstant(occurredAt, data.timezone);
    await recalculateAttendanceRange({
        fromDate: addDays(date, -1),
        toDate: date,
        employeeIds: [employeeId],
    });
}
