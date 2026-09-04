import assert from 'node:assert/strict';

import { normalizeHikvisionAttendanceEvent } from '../src/lib/hikvisionAttendance';

const rawEvent = normalizeHikvisionAttendanceEvent({
    eventType: 'AccessControllerEvent',
    eventState: 'active',
    dateTime: '2026-08-31T18:15:00-06:00',
    activePostCount: 1,
    picture: 'este campo debe descartarse',
    AccessControllerEvent: {
        employeeNoString: 'EMP-001',
        serialNo: 1234,
        majorEventType: 5,
        subEventType: 75,
        currentVerifyMode: 'faceOrFpOrCardOrPw',
        attendanceStatus: 'checkIn',
        statusValue: 0,
        name: 'este campo también debe descartarse',
    },
});

assert.equal(rawEvent.ok, true);
if (rawEvent.ok) {
    assert.equal(rawEvent.event.employeeExternalNo, 'EMP-001');
    assert.equal(rawEvent.event.eventSerial, '1234');
    assert.equal(rawEvent.event.occurredAt, '2026-09-01T00:15:00.000Z');
    assert.equal(rawEvent.event.direction, 'entry');
    assert.equal('picture' in rawEvent.event, false);
    assert.equal('name' in rawEvent.event, false);
}

const normalizedEvent = normalizeHikvisionAttendanceEvent({
    device_id: 'acceso-principal',
    eventType: 'AccessControllerEvent',
    employeeNoString: 'EMP-002',
    dateTime: '2026-08-31T18:20:00-06:00',
    serialNo: '99999999999999999999',
    major: 5,
    minor: 75,
    direction: 'exit',
});
assert.equal(normalizedEvent.ok, true);

const breakEvent = normalizeHikvisionAttendanceEvent({
    eventType: 'AccessControllerEvent',
    eventState: 'active',
    dateTime: '2026-08-31T18:15:00-06:00',
    AccessControllerEvent: {
        employeeNoString: 'EMP-001', serialNo: 1237,
        majorEventType: 5, subEventType: 75, attendanceStatus: 'breakOut',
    },
});
assert.equal(breakEvent.ok && breakEvent.event.direction, 'break_start');

const unknownDirection = normalizeHikvisionAttendanceEvent({
    eventType: 'AccessControllerEvent',
    eventState: 'active',
    dateTime: '2026-08-31T18:15:00-06:00',
    AccessControllerEvent: {
        employeeNoString: 'EMP-001', serialNo: 1238,
        majorEventType: 5, subEventType: 75, attendanceStatus: 'undefined',
    },
});
assert.deepEqual(unknownDirection, { ok: false, reason: 'direction_not_supported' });

const rejectedFace = normalizeHikvisionAttendanceEvent({
    eventType: 'AccessControllerEvent',
    employeeNoString: 'EMP-001',
    dateTime: '2026-08-31T18:20:00-06:00',
    serialNo: 1235,
    major: 5,
    minor: 76,
    direction: 'entry',
});
assert.deepEqual(rejectedFace, { ok: false, reason: 'event_not_accepted' });

const missingTimezone = normalizeHikvisionAttendanceEvent({
    eventType: 'AccessControllerEvent',
    employeeNoString: 'EMP-001',
    dateTime: '2026-08-31T18:20:00',
    serialNo: 1236,
    major: 5,
    minor: 75,
    direction: 'entry',
});
assert.deepEqual(missingTimezone, { ok: false, reason: 'invalid_event' });

const invalidSerial = normalizeHikvisionAttendanceEvent({
    eventType: 'AccessControllerEvent',
    employeeNoString: 'EMP-001',
    dateTime: '2026-08-31T18:20:00-06:00',
    serialNo: '1234-abc',
    major: 5,
    minor: 75,
    direction: 'entry',
});
assert.deepEqual(invalidSerial, { ok: false, reason: 'invalid_event' });

process.stdout.write('Hikvision attendance normalization: OK\n');
