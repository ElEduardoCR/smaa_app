import assert from 'node:assert/strict';

import type { NormalizedAttendanceEvent } from '../src/lib/hikvisionAttendance';
import { hikvisionDirectLimits } from '../src/lib/hikvisionDirectEvents';
import {
    handleHikvisionDirectRequest,
    type HikvisionDirectRouteDependencies,
} from '../src/lib/hikvisionDirectRoute';

const username = 'device_test_user_2026';
const password = 'test-only-password-with-more-than-32-characters';
const deviceId = 'test-device';

const entryJson = {
    eventType: 'AccessControllerEvent',
    eventState: 'active',
    dateTime: '2026-09-02T08:00:00-06:00',
    picture: 'discard-me',
    AccessControllerEvent: {
        employeeNoString: 'EMPTEST',
        serialNo: 1001,
        majorEventType: 5,
        subEventType: 75,
        currentVerifyMode: 'face',
        attendanceStatus: 'checkIn',
        facePicture: 'discard-me-too',
    },
};

function authorization(user = username, pass = password): string {
    return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

function request(options: {
    body?: BodyInit;
    contentType?: string;
    auth?: string | null;
    method?: string;
    url?: string;
    contentLength?: number;
} = {}): Request {
    const headers = new Headers();
    if (options.auth !== null) headers.set('authorization', options.auth || authorization());
    if (options.contentType) headers.set('content-type', options.contentType);
    if (options.contentLength !== undefined) headers.set('content-length', String(options.contentLength));
    return new Request(options.url || 'https://erp.example/api/integrations/hikvision/direct-events', {
        method: options.method || 'POST',
        headers,
        body: options.body,
    });
}

function dependencies(overrides: Partial<HikvisionDirectRouteDependencies> = {}) {
    const events: NormalizedAttendanceEvent[] = [];
    const diagnostics: string[] = [];
    const value: HikvisionDirectRouteDependencies = {
        username,
        password,
        deviceId,
        persist: async event => {
            events.push(event);
            return { ok: true, status: 'recorded', httpStatus: 201 };
        },
        diagnostic: code => diagnostics.push(code),
        ...overrides,
    };
    return { value, events, diagnostics };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json() as Record<string, unknown>;
}

async function main() {
{
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        body: JSON.stringify(entryJson),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 201);
    assert.deepEqual(await responseJson(response), { ok: true, status: 'recorded' });
    assert.equal(deps.events.length, 1);
    assert.equal(deps.events[0].direction, 'entry');
    assert.equal(deps.events[0].employeeExternalNo, 'EMPTEST');
    assert.equal('picture' in deps.events[0], false);
    assert.equal('facePicture' in deps.events[0], false);
}

for (const auth of [null, authorization(username, 'incorrect-password'), 'Bearer wrong-kind']) {
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        auth,
        body: JSON.stringify(entryJson),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 401);
    assert.equal(deps.events.length, 0);
}

{
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({ method: 'PUT' }), deps.value);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
}

{
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        url: 'http://erp.example/api/integrations/hikvision/direct-events',
        body: JSON.stringify(entryJson),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 426);
}

{
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        url: 'https://erp.example/api/integrations/hikvision/direct-events?secret=forbidden',
        body: JSON.stringify(entryJson),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 400);
}

{
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        body: '{}',
        contentType: 'application/json',
        contentLength: hikvisionDirectLimits.eventPartBytes + 1,
    }), deps.value);
    assert.equal(response.status, 413);
}

{
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert>
  <eventType>AccessControllerEvent</eventType>
  <eventState>active</eventState>
  <dateTime>2026-09-02T17:00:00-06:00</dateTime>
  <pictureURL>https://forbidden.example/private.jpg</pictureURL>
  <AccessControllerEvent>
    <employeeNoString>EMPTEST</employeeNoString>
    <serialNo>1002</serialNo>
    <majorEventType>5</majorEventType>
    <subEventType>75</subEventType>
    <currentVerifyMode>face</currentVerifyMode>
    <attendanceStatus>checkOut</attendanceStatus>
  </AccessControllerEvent>
</EventNotificationAlert>`;
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        body: xml,
        contentType: 'application/xml; charset=UTF-8',
    }), deps.value);
    assert.equal(response.status, 201);
    assert.equal(deps.events[0].direction, 'exit');
    assert.equal('pictureURL' in deps.events[0], false);
}

{
    const boundary = 'AaB03xCaseSensitiveBoundary';
    const binary = Buffer.alloc(256 * 1024, 0xff);
    const multipart = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
        binary,
        Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
        Buffer.from(JSON.stringify(entryJson)),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        body: multipart,
        contentType: `multipart/mixed; boundary="${boundary}"`,
    }), deps.value);
    assert.equal(response.status, 201);
    assert.equal(deps.events.length, 1);
    assert.equal(deps.events[0].direction, 'entry');
}

{
    const withoutStatus = structuredClone(entryJson);
    delete (withoutStatus.AccessControllerEvent as Partial<typeof entryJson.AccessControllerEvent>).attendanceStatus;
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        body: JSON.stringify(withoutStatus),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 202);
    assert.deepEqual(await responseJson(response), { ok: true, status: 'ignored' });
    assert.deepEqual(deps.diagnostics, ['direction_not_supported']);
    assert.equal(deps.events.length, 0);
}

{
    const inactive = structuredClone(entryJson);
    inactive.eventState = 'inactive';
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        body: JSON.stringify(inactive),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 202);
    assert.deepEqual(await responseJson(response), { ok: true, status: 'ignored' });
    assert.deepEqual(deps.diagnostics, ['event_not_accepted']);
    assert.equal(deps.events.length, 0);
}

{
    const heartbeat = `<?xml version="1.0"?><EventNotificationAlert>
      <eventType>heartBeat</eventType><eventState>active</eventState>
      <dateTime>2026-09-02T12:00:00-06:00</dateTime>
    </EventNotificationAlert>`;
    const deps = dependencies();
    const response = await handleHikvisionDirectRequest(request({
        body: heartbeat,
        contentType: 'application/xml',
    }), deps.value);
    assert.equal(response.status, 202);
    assert.deepEqual(await responseJson(response), { ok: true, status: 'ignored' });
    assert.deepEqual(deps.diagnostics, ['invalid_event']);
    assert.equal(deps.events.length, 0);
}

{
    const deps = dependencies({
        persist: async () => ({ ok: true, status: 'duplicate', httpStatus: 200 }),
    });
    const response = await handleHikvisionDirectRequest(request({
        body: JSON.stringify(entryJson),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), { ok: true, status: 'duplicate' });
}

{
    const deps = dependencies({
        persist: async () => ({ ok: false, error: 'employee_not_mapped', httpStatus: 422 }),
    });
    const response = await handleHikvisionDirectRequest(request({
        body: JSON.stringify(entryJson),
        contentType: 'application/json',
    }), deps.value);
    assert.equal(response.status, 422);
    assert.deepEqual(await responseJson(response), { ok: false, error: 'employee_not_mapped' });
}

    process.stdout.write('Hikvision direct endpoint: OK\n');
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
