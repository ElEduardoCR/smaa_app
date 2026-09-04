import { z } from 'zod';

import type { AttendanceDirection } from '@/lib/attendanceCalculation';

const boundedText = (max: number) => z.string().trim().min(1).max(max);

const serialSchema = z.union([
    z.number().int().nonnegative().safe(),
    z.string().trim().regex(/^[0-9]{1,32}$/),
]).transform(String);

const dateTimeSchema = z.string().trim().max(64).refine(
    value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
    'dateTime debe ser ISO 8601 e incluir zona horaria.',
).transform(value => new Date(value).toISOString());

const commonMetadata = {
    eventState: z.string().trim().max(32).optional(),
    currentVerifyMode: z.string().trim().max(64).optional(),
    attendanceStatus: z.string().trim().max(64).optional(),
    statusValue: z.number().int().optional(),
    activePostCount: z.number().int().nonnegative().optional(),
};

const hikvisionEnvelopeSchema = z.object({
    deviceId: boundedText(128).optional(),
    device_id: boundedText(128).optional(),
    eventType: boundedText(64),
    dateTime: dateTimeSchema,
    eventState: commonMetadata.eventState,
    activePostCount: commonMetadata.activePostCount,
    AccessControllerEvent: z.object({
        employeeNoString: boundedText(64),
        serialNo: serialSchema,
        majorEventType: z.number().int(),
        subEventType: z.number().int(),
        currentVerifyMode: commonMetadata.currentVerifyMode,
        attendanceStatus: commonMetadata.attendanceStatus,
        statusValue: commonMetadata.statusValue,
    }).strip(),
}).strip();

const normalizedEventSchema = z.object({
    deviceId: boundedText(128).optional(),
    device_id: boundedText(128).optional(),
    eventType: boundedText(64),
    employeeNoString: boundedText(64),
    dateTime: dateTimeSchema,
    serialNo: serialSchema,
    major: z.number().int(),
    minor: z.number().int(),
    direction: z.enum(['entry', 'exit', 'break_start', 'break_end']),
    ...commonMetadata,
}).strip();

export type NormalizedAttendanceEvent = {
    claimedDeviceId?: string;
    employeeExternalNo: string;
    occurredAt: string;
    eventSerial: string;
    eventType: string;
    majorEventType: number;
    subEventType: number;
    eventState?: string;
    verificationMode?: string;
    attendanceStatus?: string;
    statusValue?: number;
    activePostCount?: number;
    direction: AttendanceDirection;
};

export type AttendanceNormalizationResult =
    | { ok: true; event: NormalizedAttendanceEvent }
    | { ok: false; reason: 'invalid_event' | 'event_not_accepted' | 'direction_not_supported' };

const ATTENDANCE_STATUS_DIRECTIONS: Record<string, AttendanceDirection> = {
    checkin: 'entry',
    in: 'entry',
    onduty: 'entry',
    dutyon: 'entry',
    overtimein: 'entry',
    checkout: 'exit',
    out: 'exit',
    offduty: 'exit',
    dutyoff: 'exit',
    overtimeout: 'exit',
    breakout: 'break_start',
    breakstart: 'break_start',
    breakin: 'break_end',
    breakend: 'break_end',
};

export function directionFromAttendanceStatus(status: string | undefined): AttendanceDirection | null {
    if (!status) return null;
    return ATTENDANCE_STATUS_DIRECTIONS[status.toLowerCase().replace(/[^a-z]/g, '')] || null;
}

/**
 * Reduce un JSON normalizado o el evento JSON de Hikvision a una allowlist.
 * Los campos desconocidos (incluidas imágenes o datos personales extra) se descartan.
 */
export function normalizeHikvisionAttendanceEvent(input: unknown): AttendanceNormalizationResult {
    const envelope = hikvisionEnvelopeSchema.safeParse(input);
    let event: NormalizedAttendanceEvent;

    if (envelope.success) {
        const payload = envelope.data.AccessControllerEvent;
        event = {
            claimedDeviceId: envelope.data.deviceId || envelope.data.device_id,
            employeeExternalNo: payload.employeeNoString,
            occurredAt: envelope.data.dateTime,
            eventSerial: payload.serialNo,
            eventType: envelope.data.eventType,
            majorEventType: payload.majorEventType,
            subEventType: payload.subEventType,
            eventState: envelope.data.eventState,
            verificationMode: payload.currentVerifyMode,
            attendanceStatus: payload.attendanceStatus,
            statusValue: payload.statusValue,
            activePostCount: envelope.data.activePostCount,
            direction: directionFromAttendanceStatus(payload.attendanceStatus)!,
        };
    } else {
        const normalized = normalizedEventSchema.safeParse(input);
        if (!normalized.success) return { ok: false, reason: 'invalid_event' };

        event = {
            claimedDeviceId: normalized.data.deviceId || normalized.data.device_id,
            employeeExternalNo: normalized.data.employeeNoString,
            occurredAt: normalized.data.dateTime,
            eventSerial: normalized.data.serialNo,
            eventType: normalized.data.eventType,
            majorEventType: normalized.data.major,
            subEventType: normalized.data.minor,
            eventState: normalized.data.eventState,
            verificationMode: normalized.data.currentVerifyMode,
            attendanceStatus: normalized.data.attendanceStatus,
            statusValue: normalized.data.statusValue,
            activePostCount: normalized.data.activePostCount,
            direction: normalized.data.direction,
        };
    }

    if (
        event.eventType !== 'AccessControllerEvent'
        || event.majorEventType !== 5
        || event.subEventType !== 75
        || (event.eventState !== undefined && event.eventState !== 'active')
    ) {
        return { ok: false, reason: 'event_not_accepted' };
    }

    if (!event.direction) return { ok: false, reason: 'direction_not_supported' };

    const statusDirection = directionFromAttendanceStatus(event.attendanceStatus);
    if (statusDirection && statusDirection !== event.direction) {
        return { ok: false, reason: 'direction_not_supported' };
    }

    return { ok: true, event };
}
