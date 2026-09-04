import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { normalizeHikvisionAttendanceEvent } from '@/lib/hikvisionAttendance';
import { persistHikvisionAttendanceEvent } from '@/lib/hikvisionAttendanceReceiver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 64 * 1024;

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = createHash('sha256').update(left, 'utf8').digest();
    const rightBuffer = createHash('sha256').update(right, 'utf8').digest();
    return timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidSecret(request: NextRequest, expected: string): boolean {
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return false;
    return safeEqual(authorization.slice(7), expected);
}

async function readLimitedJson(request: NextRequest): Promise<unknown> {
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        throw new Error('body_too_large');
    }

    if (!request.body) throw new Error('invalid_json');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
            await reader.cancel();
            throw new Error('body_too_large');
        }
        chunks.push(value);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }

    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
        throw new Error('invalid_json');
    }
}

function safeError(error: string, status: number): NextResponse {
    return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
    const webhookSecret = process.env.HIKVISION_WEBHOOK_SECRET;
    const deviceId = process.env.HIKVISION_DEVICE_ID;

    if (!webhookSecret || webhookSecret.length < 32 || !deviceId) {
        return safeError('service_unavailable', 503);
    }
    if (!hasValidSecret(request, webhookSecret)) {
        return safeError('unauthorized', 401);
    }
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        return safeError('unsupported_media_type', 415);
    }

    let input: unknown;
    try {
        input = await readLimitedJson(request);
    } catch (error) {
        return safeError(error instanceof Error && error.message === 'body_too_large' ? 'body_too_large' : 'invalid_json', error instanceof Error && error.message === 'body_too_large' ? 413 : 400);
    }

    const normalized = normalizeHikvisionAttendanceEvent(input);
    if (!normalized.ok) return safeError(normalized.reason, 422);

    const result = await persistHikvisionAttendanceEvent(normalized.event, deviceId);
    if (!result.ok) return safeError(result.error, result.httpStatus);
    return NextResponse.json({ ok: true, status: result.status }, { status: result.httpStatus });
}
