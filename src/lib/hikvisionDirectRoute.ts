import {
    directionFromAttendanceStatus,
    normalizeHikvisionAttendanceEvent,
    type NormalizedAttendanceEvent,
} from '@/lib/hikvisionAttendance';
import {
    hasValidDirectBasicAuth,
    HikvisionDirectBodyError,
    isSecureDirectRequest,
    readHikvisionDirectEvent,
} from '@/lib/hikvisionDirectEvents';

type PersistResult =
    | { ok: true; status: 'recorded' | 'duplicate'; httpStatus: 200 | 201 }
    | { ok: false; error: string; httpStatus: number };

export type HikvisionDirectRouteDependencies = {
    username: string;
    password: string;
    deviceId: string;
    persist: (event: NormalizedAttendanceEvent, deviceId: string) => Promise<PersistResult>;
    diagnostic?: (code: string) => void;
};

function json(body: Record<string, unknown>, status: number, headers?: HeadersInit): Response {
    return Response.json(body, {
        status,
        headers: { 'cache-control': 'no-store', ...headers },
    });
}

function bodyErrorResponse(error: HikvisionDirectBodyError): Response {
    if (error.code === 'body_too_large') return json({ ok: false, error: error.code }, 413);
    if (error.code === 'body_timeout') return json({ ok: false, error: error.code }, 408);
    if (error.code === 'unsupported_media_type') return json({ ok: false, error: error.code }, 415);
    return json({ ok: false, error: 'invalid_body' }, 400);
}

export async function handleHikvisionDirectRequest(
    request: Request,
    dependencies: HikvisionDirectRouteDependencies,
): Promise<Response> {
    if (request.method !== 'POST') {
        return json({ ok: false, error: 'method_not_allowed' }, 405, { allow: 'POST' });
    }
    if (!isSecureDirectRequest(request)) return json({ ok: false, error: 'https_required' }, 426);
    if (new URL(request.url).search) return json({ ok: false, error: 'query_not_allowed' }, 400);

    if (!hasValidDirectBasicAuth(
        request.headers.get('authorization'),
        dependencies.username,
        dependencies.password,
    )) {
        return json(
            { ok: false, error: 'unauthorized' },
            401,
            { 'www-authenticate': 'Basic realm="hikvision-direct", charset="UTF-8"' },
        );
    }

    let input: unknown;
    try {
        input = await readHikvisionDirectEvent(request);
    } catch (error) {
        return bodyErrorResponse(
            error instanceof HikvisionDirectBodyError
                ? error
                : new HikvisionDirectBodyError('invalid_body'),
        );
    }

    const normalized = normalizeHikvisionAttendanceEvent(input);
    if (!normalized.ok) {
        dependencies.diagnostic?.(normalized.reason);
        return json({ ok: true, status: 'ignored' }, 202);
    }
    if (normalized.event.eventState !== 'active') {
        dependencies.diagnostic?.('event_not_accepted');
        return json({ ok: true, status: 'ignored' }, 202);
    }
    if (
        !normalized.event.attendanceStatus
        || directionFromAttendanceStatus(normalized.event.attendanceStatus) !== normalized.event.direction
    ) {
        dependencies.diagnostic?.('direction_not_supported');
        return json({ ok: true, status: 'ignored' }, 202);
    }

    const result = await dependencies.persist(normalized.event, dependencies.deviceId);
    if (!result.ok) return json({ ok: false, error: result.error }, result.httpStatus);
    return json({ ok: true, status: result.status }, result.httpStatus);
}
