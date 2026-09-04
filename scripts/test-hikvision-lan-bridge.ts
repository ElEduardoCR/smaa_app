import assert from 'node:assert/strict';

import {
    HikvisionAlertStreamParser,
    normalizeBridgePart,
    parseAllowedHikvisionXml,
} from './hikvision-lan-bridge';

const nativeEvent = {
    eventType: 'AccessControllerEvent',
    dateTime: '2026-09-01T08:00:00-06:00',
    eventState: 'active',
    activePostCount: 1,
    AccessControllerEvent: {
        employeeNoString: 'TEST-001',
        serialNo: 42,
        majorEventType: 5,
        subEventType: 75,
        currentVerifyMode: 'face',
        attendanceStatus: 'checkIn',
    },
};

const xml = `<?xml version="1.0"?>
<EventNotificationAlert>
  <eventType>AccessControllerEvent</eventType>
  <dateTime>2026-09-01T18:00:00-06:00</dateTime>
  <eventState>active</eventState>
  <AccessControllerEvent>
    <employeeNoString>TEST-002</employeeNoString>
    <serialNo>43</serialNo>
    <majorEventType>5</majorEventType>
    <subEventType>75</subEventType>
    <attendanceStatus>checkOut</attendanceStatus>
  </AccessControllerEvent>
</EventNotificationAlert>`;

async function main() {
    const jsonPayload = normalizeBridgePart('application/json', Buffer.from(JSON.stringify(nativeEvent)));
    assert.equal(jsonPayload?.direction, 'entry');
    assert.equal(jsonPayload?.employeeNoString, 'TEST-001');

    assert.equal(parseAllowedHikvisionXml(xml)?.AccessControllerEvent.employeeNoString, 'TEST-002');
    assert.equal(normalizeBridgePart('application/xml', Buffer.from(xml))?.direction, 'exit');

    const image = Buffer.alloc(80 * 1024, 7);
    const eventBody = Buffer.from(JSON.stringify(nativeEvent));
    const streamBody = Buffer.concat([
        Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n'),
        Buffer.from(`--test\r\nContent-Type: image/jpeg\r\nContent-Length: ${image.length}\r\n\r\n`),
        image,
        Buffer.from(`\r\n--test\r\nContent-Type: application/json\r\nContent-Length: ${eventBody.length}\r\n\r\n`),
        eventBody,
    ]);

    const received: string[] = [];
    const parser = new HikvisionAlertStreamParser((contentType, body) => {
        const normalized = normalizeBridgePart(contentType, body);
        if (normalized) received.push(normalized.direction);
    });

    for (let offset = 0; offset < streamBody.length; offset += 997) {
        await parser.push(streamBody.subarray(offset, offset + 997));
    }
    assert.deepEqual(received, ['entry']);

    assert.equal(normalizeBridgePart('application/json', Buffer.from(JSON.stringify({
        ...nativeEvent,
        AccessControllerEvent: { ...nativeEvent.AccessControllerEvent, attendanceStatus: 'undefined' },
    }))), null);

    console.info('Hikvision LAN bridge tests passed.');
}

void main();
