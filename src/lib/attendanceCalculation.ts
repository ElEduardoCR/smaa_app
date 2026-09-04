export type AttendanceDirection = 'entry' | 'exit' | 'break_start' | 'break_end';

export type AttendanceEventForCalculation = {
    id?: string;
    deviceId: string;
    eventSerial: string;
    occurredAt: string;
    direction: AttendanceDirection;
};

export type AttendanceScheduleForCalculation = {
    id: string;
    timezone: string;
    startTime: string;
    endTime: string;
    workDays: number[];
    lateToleranceMinutes: number;
    earlyDepartureToleranceMinutes: number;
    overtimeThresholdMinutes: number;
};

export type AttendanceSummaryCalculation = {
    firstEntryAt: string | null;
    lastExitAt: string | null;
    workedMinutes: number;
    breakMinutes: number;
    payableMinutes: number;
    estimatedAmount: number | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    lateMinutes: number;
    earlyDepartureMinutes: number;
    overtimeMinutes: number;
    status: 'pending' | 'complete' | 'incomplete' | 'absent' | 'review_required';
    incidents: string[];
    sourceEventCount: number;
};

type PairedResult = Omit<AttendanceSummaryCalculation,
    'estimatedAmount' | 'scheduledStartAt' | 'scheduledEndAt'
    | 'lateMinutes' | 'earlyDepartureMinutes' | 'overtimeMinutes' | 'status'>;

const MINUTE_MS = 60_000;

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function diffMinutes(end: Date, start: Date): number {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / MINUTE_MS));
}

function orderedUnique(values: string[]): string[] {
    return [...new Set(values)];
}

function parseClock(value: string): { hour: number; minute: number; second: number } {
    const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) throw new Error('invalid_schedule_time');
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);
    if (hour > 23 || minute > 59 || second > 59) throw new Error('invalid_schedule_time');
    return { hour, minute, second };
}

function addDateDays(date: string, days: number): string {
    const result = new Date(`${date}T12:00:00.000Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
}

function zonedParts(date: Date, timezone: string): Record<string, number> {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const output: Record<string, number> = {};
    for (const part of parts) {
        if (part.type !== 'literal') output[part.type] = Number(part.value);
    }
    return output;
}

/** Convierte una fecha/hora civil de una zona IANA a un instante UTC. */
export function zonedDateTimeToIso(date: string, time: string, timezone: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const clock = parseClock(time);
    const targetWallTime = Date.UTC(year, month - 1, day, clock.hour, clock.minute, clock.second);
    let guess = targetWallTime;

    // La corrección iterativa evita depender de la zona horaria del proceso.
    for (let iteration = 0; iteration < 4; iteration += 1) {
        const parts = zonedParts(new Date(guess), timezone);
        const representedWallTime = Date.UTC(
            parts.year, parts.month - 1, parts.day,
            parts.hour, parts.minute, parts.second,
        );
        const correction = targetWallTime - representedWallTime;
        guess += correction;
        if (correction === 0) break;
    }

    return new Date(guess).toISOString();
}

export function localDateForInstant(instant: string | Date, timezone: string): string {
    const parts = zonedParts(typeof instant === 'string' ? new Date(instant) : instant, timezone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function weekdayForDate(date: string): number {
    return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

export function scheduleWindow(
    workDate: string,
    schedule: AttendanceScheduleForCalculation,
): { start: Date; end: Date; isWorkDay: boolean } {
    const start = new Date(zonedDateTimeToIso(workDate, schedule.startTime, schedule.timezone));
    const overnight = parseClock(schedule.endTime).hour * 3600
        + parseClock(schedule.endTime).minute * 60
        + parseClock(schedule.endTime).second
        <= parseClock(schedule.startTime).hour * 3600
        + parseClock(schedule.startTime).minute * 60
        + parseClock(schedule.startTime).second;
    const endDate = overnight ? addDateDays(workDate, 1) : workDate;
    const end = new Date(zonedDateTimeToIso(endDate, schedule.endTime, schedule.timezone));
    return { start, end, isWorkDay: schedule.workDays.includes(weekdayForDate(workDate)) };
}

export function pairAttendanceEvents(
    events: AttendanceEventForCalculation[],
    maxShiftMinutes = 960,
): PairedResult {
    const incidents: string[] = [];
    const seen = new Set<string>();
    const sorted = [...events].sort((left, right) =>
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());

    let openEntry: Date | null = null;
    let openBreak: Date | null = null;
    let intervalBreakMinutes = 0;
    let workedMinutes = 0;
    let breakMinutes = 0;
    let firstEntry: Date | null = null;
    let lastExit: Date | null = null;
    let previousDirection: AttendanceDirection | null = null;

    for (const event of sorted) {
        const key = event.id || `${event.deviceId}\u0000${event.eventSerial}`;
        if (seen.has(key)) {
            incidents.push('duplicate_event');
            continue;
        }
        seen.add(key);

        const occurredAt = new Date(event.occurredAt);
        if (Number.isNaN(occurredAt.getTime())) {
            incidents.push('invalid_event_time');
            continue;
        }

        if (event.direction === 'entry') {
            if (!firstEntry) firstEntry = occurredAt;
            if (openEntry) {
                incidents.push('consecutive_entry');
            } else {
                openEntry = occurredAt;
                openBreak = null;
                intervalBreakMinutes = 0;
            }
        } else if (event.direction === 'exit') {
            lastExit = occurredAt;
            if (!openEntry) {
                incidents.push(previousDirection === 'exit' ? 'consecutive_exit' : 'missing_entry');
            } else {
                if (openBreak) {
                    incidents.push('missing_break_end');
                    openBreak = null;
                }
                const intervalMinutes = diffMinutes(occurredAt, openEntry);
                if (occurredAt <= openEntry) {
                    incidents.push('invalid_event_order');
                } else if (intervalMinutes > maxShiftMinutes) {
                    incidents.push('excessive_shift');
                } else {
                    workedMinutes += intervalMinutes;
                    breakMinutes += Math.min(intervalBreakMinutes, intervalMinutes);
                }
                openEntry = null;
                intervalBreakMinutes = 0;
            }
        } else if (event.direction === 'break_start') {
            if (!openEntry) {
                incidents.push('break_outside_shift');
            } else if (openBreak) {
                incidents.push('consecutive_break_start');
            } else {
                openBreak = occurredAt;
            }
        } else if (event.direction === 'break_end') {
            if (!openEntry) {
                incidents.push('break_outside_shift');
            } else if (!openBreak) {
                incidents.push('missing_break_start');
            } else if (occurredAt <= openBreak) {
                incidents.push('invalid_break_order');
                openBreak = null;
            } else {
                intervalBreakMinutes += diffMinutes(occurredAt, openBreak);
                openBreak = null;
            }
        }

        previousDirection = event.direction;
    }

    if (openBreak) incidents.push('missing_break_end');
    if (openEntry) incidents.push('missing_exit');

    return {
        firstEntryAt: firstEntry?.toISOString() || null,
        lastExitAt: lastExit?.toISOString() || null,
        workedMinutes,
        breakMinutes,
        payableMinutes: Math.max(0, workedMinutes - breakMinutes),
        incidents: orderedUnique(incidents),
        sourceEventCount: seen.size,
    };
}

export function calculateHourlyAttendance(input: {
    events: AttendanceEventForCalculation[];
    hourlyRate: number | null;
    maxShiftMinutes?: number;
}): AttendanceSummaryCalculation {
    const paired = pairAttendanceEvents(input.events, input.maxShiftMinutes);
    const incidents = [...paired.incidents];
    const usableRate = input.hourlyRate !== null && input.hourlyRate > 0 ? input.hourlyRate : null;
    if (usableRate === null) incidents.push('missing_hourly_rate');

    const hasPair = paired.workedMinutes > 0;
    const status = incidents.length > 0
        ? (hasPair ? 'review_required' : 'incomplete')
        : (hasPair ? 'complete' : 'pending');

    return {
        ...paired,
        estimatedAmount: usableRate === null
            ? null
            : roundMoney((paired.payableMinutes / 60) * usableRate),
        scheduledStartAt: null,
        scheduledEndAt: null,
        lateMinutes: 0,
        earlyDepartureMinutes: 0,
        overtimeMinutes: 0,
        status,
        incidents: orderedUnique(incidents),
    };
}

export function calculateScheduledAttendance(input: {
    workDate: string;
    events: AttendanceEventForCalculation[];
    schedule: AttendanceScheduleForCalculation | null;
    now?: Date;
    maxShiftMinutes?: number;
}): AttendanceSummaryCalculation {
    const paired = pairAttendanceEvents(input.events, input.maxShiftMinutes);
    const incidents = [...paired.incidents];
    const now = input.now || new Date();

    if (!input.schedule) {
        incidents.push('schedule_missing');
        return {
            ...paired,
            estimatedAmount: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            lateMinutes: 0,
            earlyDepartureMinutes: 0,
            overtimeMinutes: 0,
            status: 'review_required',
            incidents: orderedUnique(incidents),
        };
    }

    const window = scheduleWindow(input.workDate, input.schedule);
    if (!window.isWorkDay) {
        if (input.events.length > 0) {
            incidents.push('non_workday', 'overtime_pending');
        }
        return {
            ...paired,
            estimatedAmount: null,
            scheduledStartAt: window.start.toISOString(),
            scheduledEndAt: window.end.toISOString(),
            lateMinutes: 0,
            earlyDepartureMinutes: 0,
            overtimeMinutes: paired.payableMinutes,
            status: input.events.length > 0 ? 'review_required' : 'pending',
            incidents: orderedUnique(incidents),
        };
    }

    if (input.events.length === 0) {
        const ended = now.getTime() > window.end.getTime();
        if (ended) incidents.push('absence');
        return {
            ...paired,
            estimatedAmount: null,
            scheduledStartAt: window.start.toISOString(),
            scheduledEndAt: window.end.toISOString(),
            lateMinutes: 0,
            earlyDepartureMinutes: 0,
            overtimeMinutes: 0,
            status: ended ? 'absent' : 'pending',
            incidents: orderedUnique(incidents),
        };
    }

    const firstEntry = paired.firstEntryAt ? new Date(paired.firstEntryAt) : null;
    const lastExit = paired.lastExitAt ? new Date(paired.lastExitAt) : null;
    const rawLate = firstEntry ? diffMinutes(firstEntry, window.start) : 0;
    const rawEarly = lastExit ? diffMinutes(window.end, lastExit) : 0;
    const lateMinutes = rawLate > input.schedule.lateToleranceMinutes ? rawLate : 0;
    const earlyDepartureMinutes = rawEarly > input.schedule.earlyDepartureToleranceMinutes ? rawEarly : 0;
    if (lateMinutes > 0) incidents.push('late');
    if (earlyDepartureMinutes > 0) incidents.push('early_departure');

    const beforeShift = firstEntry && firstEntry < window.start
        ? diffMinutes(window.start, firstEntry) : 0;
    const afterShift = lastExit && lastExit > window.end
        ? diffMinutes(lastExit, window.end) : 0;
    const rawOvertime = beforeShift + afterShift;
    const overtimeMinutes = rawOvertime >= input.schedule.overtimeThresholdMinutes ? rawOvertime : 0;
    if (overtimeMinutes > 0) incidents.push('overtime_pending');

    const pairingProblems = paired.incidents.length > 0;
    return {
        ...paired,
        estimatedAmount: null,
        scheduledStartAt: window.start.toISOString(),
        scheduledEndAt: window.end.toISOString(),
        lateMinutes,
        earlyDepartureMinutes,
        overtimeMinutes,
        status: pairingProblems ? 'review_required' : 'complete',
        incidents: orderedUnique(incidents),
    };
}
