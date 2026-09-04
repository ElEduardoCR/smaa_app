import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_EVENT_PART_BYTES = 64 * 1024;
const MAX_MULTIPART_BODY_BYTES = 4 * 1024 * 1024;
const MAX_MULTIPART_HEADER_BYTES = 16 * 1024;
const BODY_READ_TIMEOUT_MS = 8_000;

type AllowedEventEnvelope = {
    eventType: string;
    dateTime: string;
    eventState?: string;
    activePostCount?: number;
    AccessControllerEvent: {
        employeeNoString: string;
        serialNo: string;
        majorEventType: number;
        subEventType: number;
        currentVerifyMode?: string;
        attendanceStatus?: string;
        statusValue?: number;
    };
};

export type DirectBodyError =
    | 'body_too_large'
    | 'body_timeout'
    | 'invalid_body'
    | 'unsupported_media_type';

export class HikvisionDirectBodyError extends Error {
    constructor(readonly code: DirectBodyError) {
        super(code);
        this.name = 'HikvisionDirectBodyError';
    }
}

function hashSecret(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeTextEqual(left: string, right: string): boolean {
    return timingSafeEqual(hashSecret(left), hashSecret(right));
}

function decodeBasicAuthorization(value: string | null): { username: string; password: string } | null {
    if (!value?.startsWith('Basic ')) return null;
    const encoded = value.slice(6);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return null;

    try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64'));
        const separator = decoded.indexOf(':');
        if (separator < 1) return null;
        return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
    } catch {
        return null;
    }
}

/** Valida ambos componentes contra hashes de tamaño fijo. */
export function hasValidDirectBasicAuth(
    authorization: string | null,
    expectedUsername: string,
    expectedPassword: string,
): boolean {
    const credentials = decodeBasicAuthorization(authorization);
    const username = credentials?.username || '';
    const password = credentials?.password || '';
    const usernameMatches = constantTimeTextEqual(username, expectedUsername);
    const passwordMatches = constantTimeTextEqual(password, expectedPassword);
    return Boolean(credentials) && usernameMatches && passwordMatches;
}

export function isSecureDirectRequest(request: Request): boolean {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return false;
    const forwarded = request.headers.get('x-forwarded-proto');
    return !forwarded || forwarded.split(',')[0]?.trim().toLowerCase() === 'https';
}

function decodeXmlText(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function xmlText(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'i'));
    return match ? decodeXmlText(match[1].trim()) : undefined;
}

function safeInteger(value: string | undefined): number | undefined {
    if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** Reduce XML nativo a la misma allowlist usada por el receptor JSON. */
export function parseAllowedHikvisionXml(xml: string): AllowedEventEnvelope | null {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
    const controller = xml.match(/<AccessControllerEvent(?:\s[^>]*)?>([\s\S]*?)<\/AccessControllerEvent>/i)?.[1];
    if (!controller) return null;

    const eventType = xmlText(xml, 'eventType');
    const dateTime = xmlText(xml, 'dateTime');
    const employeeNoString = xmlText(controller, 'employeeNoString');
    const serialNo = xmlText(controller, 'serialNo');
    const majorEventType = safeInteger(xmlText(controller, 'majorEventType'));
    const subEventType = safeInteger(xmlText(controller, 'subEventType'));
    if (!eventType || !dateTime || !employeeNoString || !serialNo || majorEventType === undefined || subEventType === undefined) {
        return null;
    }

    return {
        eventType,
        dateTime,
        eventState: xmlText(xml, 'eventState'),
        activePostCount: safeInteger(xmlText(xml, 'activePostCount')),
        AccessControllerEvent: {
            employeeNoString,
            serialNo,
            majorEventType,
            subEventType,
            currentVerifyMode: xmlText(controller, 'currentVerifyMode'),
            attendanceStatus: xmlText(controller, 'attendanceStatus'),
            statusValue: safeInteger(xmlText(controller, 'statusValue')),
        },
    };
}

function parseHikvisionXmlEnvelope(xml: string): Record<string, string> | null {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/<EventNotificationAlert(?:\s[^>]*)?>/i.test(xml)) return null;
    const eventType = xmlText(xml, 'eventType');
    if (!eventType || eventType.length > 64) return null;
    const envelope: Record<string, string> = { eventType };
    const eventState = xmlText(xml, 'eventState');
    const dateTime = xmlText(xml, 'dateTime');
    if (eventState && eventState.length <= 32) envelope.eventState = eventState;
    if (dateTime && dateTime.length <= 64) envelope.dateTime = dateTime;
    return envelope;
}

function parseAllowedPart(contentType: string, body: Buffer): unknown | null {
    try {
        if (contentType === 'application/json') {
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        }
        if (contentType === 'application/xml' || contentType === 'text/xml') {
            const xml = new TextDecoder('utf-8', { fatal: true }).decode(body);
            return parseAllowedHikvisionXml(xml) || parseHikvisionXmlEnvelope(xml);
        }
    } catch {
        return null;
    }
    return null;
}

async function readChunkWithDeadline(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new HikvisionDirectBodyError('body_timeout');

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new HikvisionDirectBodyError('body_timeout')), remaining);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Buffer> {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new HikvisionDirectBodyError('body_too_large');
    }
    if (!request.body) throw new HikvisionDirectBodyError('invalid_body');

    const reader = request.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    const deadline = Date.now() + BODY_READ_TIMEOUT_MS;
    try {
        while (true) {
            const { done, value } = await readChunkWithDeadline(reader, deadline);
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) throw new HikvisionDirectBodyError('body_too_large');
            chunks.push(Buffer.from(value));
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }
    return Buffer.concat(chunks, total);
}

function multipartBoundary(contentType: string): string | null {
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    const boundary = match?.[1] || match?.[2];
    if (!boundary || boundary.length > 200 || !/^[\x21-\x7e]+$/.test(boundary)) return null;
    return boundary;
}

function headerContentType(headerBlock: string): string {
    const match = headerBlock.match(/(?:^|\r\n)content-type:\s*([^;\r\n]+)/i);
    return match?.[1]?.trim().toLowerCase() || '';
}

async function readMultipartEvent(request: Request, contentType: string): Promise<unknown> {
    const boundary = multipartBoundary(contentType);
    if (!boundary || !request.body) throw new HikvisionDirectBodyError('invalid_body');
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MULTIPART_BODY_BYTES) {
        throw new HikvisionDirectBodyError('body_too_large');
    }

    const delimiter = Buffer.from(`--${boundary}`, 'ascii');
    const bodyMarker = Buffer.from(`\r\n--${boundary}`, 'ascii');
    const reader = request.body.getReader();
    const deadline = Date.now() + BODY_READ_TIMEOUT_MS;
    let total = 0;
    let buffer = Buffer.alloc(0);
    let state: 'boundary' | 'headers' | 'body' = 'boundary';
    let allowedType = '';
    let allowedChunks: Buffer[] = [];
    let allowedLength = 0;
    const parsedParts: unknown[] = [];
    let closed = false;

    const consumePartBytes = (bytes: Buffer) => {
        if (!allowedType || bytes.length === 0) return;
        allowedLength += bytes.length;
        if (allowedLength > MAX_EVENT_PART_BYTES) throw new HikvisionDirectBodyError('body_too_large');
        allowedChunks.push(Buffer.from(bytes));
    };
    const finishPart = () => {
        if (allowedType) {
            const parsed = parseAllowedPart(allowedType, Buffer.concat(allowedChunks, allowedLength));
            if (parsed) parsedParts.push(parsed);
        }
        allowedType = '';
        allowedChunks = [];
        allowedLength = 0;
    };

    try {
        while (!closed) {
            const { done, value } = await readChunkWithDeadline(reader, deadline);
            if (done) break;
            total += value.byteLength;
            if (total > MAX_MULTIPART_BODY_BYTES) throw new HikvisionDirectBodyError('body_too_large');
            buffer = Buffer.concat([buffer, Buffer.from(value)]);

            parse: while (true) {
                if (state === 'boundary') {
                    if (!buffer.subarray(0, delimiter.length).equals(delimiter)) {
                        const index = buffer.indexOf(delimiter);
                        if (index < 0) {
                            if (buffer.length > delimiter.length) buffer = buffer.subarray(buffer.length - delimiter.length);
                            break parse;
                        }
                        buffer = buffer.subarray(index);
                    }
                    const lineEnd = buffer.indexOf('\r\n');
                    if (lineEnd < 0) break parse;
                    const line = buffer.subarray(0, lineEnd).toString('ascii');
                    buffer = buffer.subarray(lineEnd + 2);
                    if (line === `${delimiter.toString('ascii')}--`) {
                        closed = true;
                        break parse;
                    }
                    if (line !== delimiter.toString('ascii')) throw new HikvisionDirectBodyError('invalid_body');
                    state = 'headers';
                    continue;
                }

                if (state === 'headers') {
                    const headerEnd = buffer.indexOf('\r\n\r\n');
                    if (headerEnd < 0) {
                        if (buffer.length > MAX_MULTIPART_HEADER_BYTES) throw new HikvisionDirectBodyError('invalid_body');
                        break parse;
                    }
                    const headers = buffer.subarray(0, headerEnd).toString('latin1');
                    buffer = buffer.subarray(headerEnd + 4);
                    const partType = headerContentType(headers);
                    allowedType = ['application/json', 'application/xml', 'text/xml'].includes(partType) ? partType : '';
                    state = 'body';
                    continue;
                }

                const markerIndex = buffer.indexOf(bodyMarker);
                if (markerIndex >= 0) {
                    consumePartBytes(buffer.subarray(0, markerIndex));
                    buffer = buffer.subarray(markerIndex + 2);
                    finishPart();
                    state = 'boundary';
                    continue;
                }

                const keep = bodyMarker.length - 1;
                if (buffer.length > keep) {
                    consumePartBytes(buffer.subarray(0, buffer.length - keep));
                    buffer = buffer.subarray(buffer.length - keep);
                }
                break parse;
            }
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }

    if (!closed || parsedParts.length !== 1) throw new HikvisionDirectBodyError('invalid_body');
    return parsedParts[0];
}

export async function readHikvisionDirectEvent(request: Request): Promise<unknown> {
    const rawContentType = request.headers.get('content-type')?.trim() || '';
    const contentType = rawContentType.split(';', 1)[0].toLowerCase();

    if (contentType === 'multipart/form-data' || contentType === 'multipart/mixed') {
        return readMultipartEvent(request, rawContentType);
    }
    if (!['application/json', 'application/xml', 'text/xml'].includes(contentType)) {
        throw new HikvisionDirectBodyError('unsupported_media_type');
    }

    const body = await readBoundedBody(request, MAX_EVENT_PART_BYTES);
    const parsed = parseAllowedPart(contentType, body);
    if (!parsed) throw new HikvisionDirectBodyError('invalid_body');
    return parsed;
}

export const hikvisionDirectLimits = {
    eventPartBytes: MAX_EVENT_PART_BYTES,
    multipartBodyBytes: MAX_MULTIPART_BODY_BYTES,
} as const;
