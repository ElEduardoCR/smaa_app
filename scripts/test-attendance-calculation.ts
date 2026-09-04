import assert from 'node:assert/strict';

import {
    calculateHourlyAttendance,
    calculateScheduledAttendance,
    pairAttendanceEvents,
    type AttendanceDirection,
    type AttendanceEventForCalculation,
    type AttendanceScheduleForCalculation,
} from '../src/lib/attendanceCalculation';

let serial = 1;
function event(occurredAt: string, direction: AttendanceDirection, override?: Partial<AttendanceEventForCalculation>): AttendanceEventForCalculation {
    return {
        deviceId: 'test-device',
        eventSerial: String(serial++),
        occurredAt,
        direction,
        ...override,
    };
}

const schedule: AttendanceScheduleForCalculation = {
    id: 'schedule-day',
    timezone: 'America/Chihuahua',
    startTime: '09:00:00',
    endTime: '17:00:00',
    workDays: [1, 2, 3, 4, 5],
    lateToleranceMinutes: 5,
    earlyDepartureToleranceMinutes: 5,
    overtimeThresholdMinutes: 30,
};

// Empleado por horas: tiempo real válido × tarifa existente.
const hourlyNormal = calculateHourlyAttendance({
    events: [event('2026-08-31T14:00:00Z', 'entry'), event('2026-08-31T23:00:00Z', 'exit')],
    hourlyRate: 100,
});
assert.equal(hourlyNormal.payableMinutes, 540);
assert.equal(hourlyNormal.estimatedAmount, 900);
assert.equal(hourlyNormal.status, 'complete');

const hourlyBreak = calculateHourlyAttendance({
    events: [
        event('2026-08-31T14:00:00Z', 'entry'),
        event('2026-08-31T18:00:00Z', 'break_start'),
        event('2026-08-31T19:00:00Z', 'break_end'),
        event('2026-08-31T23:00:00Z', 'exit'),
    ],
    hourlyRate: 100,
});
assert.equal(hourlyBreak.workedMinutes, 540);
assert.equal(hourlyBreak.breakMinutes, 60);
assert.equal(hourlyBreak.payableMinutes, 480);
assert.equal(hourlyBreak.estimatedAmount, 800);

// Empleado por horario: incidencias, nunca descuentos ni pago automático.
const punctual = calculateScheduledAttendance({
    workDate: '2026-08-31', schedule,
    events: [event('2026-08-31T14:58:00Z', 'entry'), event('2026-08-31T23:02:00Z', 'exit')],
    now: new Date('2026-09-01T12:00:00Z'),
});
assert.equal(punctual.status, 'complete');
assert.equal(punctual.lateMinutes, 0);
assert.equal(punctual.earlyDepartureMinutes, 0);
assert.equal(punctual.overtimeMinutes, 0);

const late = calculateScheduledAttendance({
    workDate: '2026-08-31', schedule,
    events: [event('2026-08-31T15:12:00Z', 'entry'), event('2026-08-31T23:00:00Z', 'exit')],
});
assert.equal(late.lateMinutes, 12);
assert.ok(late.incidents.includes('late'));

const early = calculateScheduledAttendance({
    workDate: '2026-08-31', schedule,
    events: [event('2026-08-31T15:00:00Z', 'entry'), event('2026-08-31T22:50:00Z', 'exit')],
});
assert.equal(early.earlyDepartureMinutes, 10);
assert.ok(early.incidents.includes('early_departure'));

const overtimePending = calculateScheduledAttendance({
    workDate: '2026-08-31', schedule,
    events: [event('2026-08-31T14:00:00Z', 'entry'), event('2026-09-01T00:00:00Z', 'exit')],
});
assert.equal(overtimePending.overtimeMinutes, 120);
assert.ok(overtimePending.incidents.includes('overtime_pending'));
assert.equal('approvedOvertimeMinutes' in overtimePending, false);

const nightSchedule: AttendanceScheduleForCalculation = {
    ...schedule,
    id: 'schedule-night', startTime: '22:00:00', endTime: '06:00:00',
};
const overnight = calculateScheduledAttendance({
    workDate: '2026-08-31', schedule: nightSchedule,
    events: [event('2026-09-01T03:58:00Z', 'entry'), event('2026-09-01T12:02:00Z', 'exit')],
});
assert.equal(overnight.status, 'complete');
assert.equal(overnight.payableMinutes, 484);

const missingExit = pairAttendanceEvents([event('2026-08-31T15:00:00Z', 'entry')]);
assert.ok(missingExit.incidents.includes('missing_exit'));
assert.equal(missingExit.payableMinutes, 0);

const missingEntry = pairAttendanceEvents([event('2026-08-31T23:00:00Z', 'exit')]);
assert.ok(missingEntry.incidents.includes('missing_entry'));
assert.equal(missingEntry.payableMinutes, 0);

const consecutive = pairAttendanceEvents([
    event('2026-08-31T15:00:00Z', 'entry'),
    event('2026-08-31T15:05:00Z', 'entry'),
    event('2026-08-31T23:00:00Z', 'exit'),
]);
assert.ok(consecutive.incidents.includes('consecutive_entry'));
assert.equal(consecutive.payableMinutes, 480);

const original = event('2026-08-31T15:00:00Z', 'entry', { eventSerial: 'duplicate' });
const duplicate = { ...original };
const deduplicated = pairAttendanceEvents([
    original, duplicate, event('2026-08-31T23:00:00Z', 'exit'),
]);
assert.ok(deduplicated.incidents.includes('duplicate_event'));
assert.equal(deduplicated.payableMinutes, 480);

const absent = calculateScheduledAttendance({
    workDate: '2026-08-31', schedule, events: [], now: new Date('2026-09-01T12:00:00Z'),
});
assert.equal(absent.status, 'absent');
assert.ok(absent.incidents.includes('absence'));

process.stdout.write('Attendance calculation: OK\n');
