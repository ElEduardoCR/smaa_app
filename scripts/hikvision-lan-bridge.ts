#!/usr/bin/env node

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
    normalizeHikvisionAttendanceEvent,
    type NormalizedAttendanceEvent,
} from '../src/lib/hikvisionAttendance';

const MAX_EVENT_PART_BYTES = 64 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;

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

type EventPartHandler = (contentType: string, body: Buffer) => void | Promise<void>;

/**
 * Parser incremental para alertStream. Las partes no JSON/XML (incluidas
 * imágenes) se saltan por Content-Length sin materializarlas completas.
 */
export class HikvisionAlertStreamParser {
    private buffer = Buffer.alloc(0);
    private pendingPart: { contentType: string; length: number } | null = null;
    private skipBytes = 0;

    constructor(private readonly onEventPart: EventPartHandler) {}

    async push(chunk: Buffer): Promise<void> {
        let incoming = chunk;
        if (this.skipBytes > 0) {
            const skipped = Math.min(this.skipBytes, incoming.length);
            this.skipBytes -= skipped;
            incoming = incoming.subarray(skipped);
        }

        if (incoming.length > 0) {
            this.buffer = Buffer.concat([this.buffer, incoming]);
        }

        while (true) {
            if (this.pendingPart) {
                if (this.buffer.length < this.pendingPart.length) return;

                const body = this.buffer.subarray(0, this.pendingPart.length);
                this.buffer = this.buffer.subarray(this.pendingPart.length);
                const { contentType } = this.pendingPart;
                this.pendingPart = null;
                await this.onEventPart(contentType, body);
                continue;
            }

            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                // Conserva solo una cola acotada si el stream trae preámbulo
                // inesperado; nunca deja crecer memoria con contenido binario.
                if (this.buffer.length > MAX_HEADER_BYTES) {
                    this.buffer = this.buffer.subarray(this.buffer.length - MAX_HEADER_BYTES);
                }
                return;
            }

            const headerBlock = this.buffer.subarray(0, headerEnd).toString('latin1');
            this.buffer = this.buffer.subarray(headerEnd + 4);

            const lengthMatch = headerBlock.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
            const typeMatch = headerBlock.match(/(?:^|\r\n)Content-Type:\s*([^;\r\n]+)/i);
            if (!lengthMatch || !typeMatch) {
                // Encabezados HTTP del handshake o preámbulo multipart.
                continue;
            }

            const length = Number(lengthMatch[1]);
            const contentType = typeMatch[1].trim().toLowerCase();
            const isAllowedType = contentType === 'application/json'
                || contentType === 'application/xml'
                || contentType === 'text/xml';

            if (!Number.isSafeInteger(length) || length < 0 || !isAllowedType || length > MAX_EVENT_PART_BYTES) {
                const skipped = Math.min(length, this.buffer.length);
                this.buffer = this.buffer.subarray(skipped);
                this.skipBytes = Math.max(0, length - skipped);
                if (this.skipBytes > 0) return;
                continue;
            }

            this.pendingPart = { contentType, length };
        }
    }
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

/** Reduce XML nativo a la misma allowlist aceptada por el ERP. */
export function parseAllowedHikvisionXml(xml: string): AllowedEventEnvelope | null {
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

function asWebhookPayload(event: NormalizedAttendanceEvent) {
    return {
        eventType: event.eventType,
        employeeNoString: event.employeeExternalNo,
        dateTime: event.occurredAt,
        serialNo: event.eventSerial,
        major: event.majorEventType,
        minor: event.subEventType,
        direction: event.direction,
        eventState: event.eventState,
        currentVerifyMode: event.verificationMode,
        attendanceStatus: event.attendanceStatus,
        statusValue: event.statusValue,
        activePostCount: event.activePostCount,
    };
}

export function normalizeBridgePart(contentType: string, body: Buffer): ReturnType<typeof asWebhookPayload> | null {
    let input: unknown;
    try {
        if (contentType === 'application/json') {
            input = JSON.parse(body.toString('utf8'));
        } else {
            input = parseAllowedHikvisionXml(body.toString('utf8'));
        }
    } catch {
        return null;
    }

    const normalized = normalizeHikvisionAttendanceEvent(input);
    return normalized.ok ? asWebhookPayload(normalized.event) : null;
}

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`missing_${name.toLowerCase()}`);
    if (/\r|\n|\0/.test(value)) throw new Error(`invalid_${name.toLowerCase()}`);
    return value;
}

function curlConfigValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function startAlertStream(): ChildProcessWithoutNullStreams {
    const terminalBaseUrl = new URL(requiredEnv('HIKVISION_TERMINAL_URL'));
    if (terminalBaseUrl.protocol !== 'https:') throw new Error('terminal_https_required');

    const username = requiredEnv('HIKVISION_TERMINAL_USER');
    const password = requiredEnv('HIKVISION_TERMINAL_PASSWORD');
    const pinnedKey = requiredEnv('HIKVISION_TERMINAL_PINNED_PUBKEY');
    if (!/^sha256\/[A-Za-z0-9+/=]+$/.test(pinnedKey)) throw new Error('invalid_terminal_pinned_pubkey');

    terminalBaseUrl.pathname = `${terminalBaseUrl.pathname.replace(/\/$/, '')}/ISAPI/Event/notification/alertStream`;
    terminalBaseUrl.search = '';
    terminalBaseUrl.hash = '';

    const child = spawn('curl', [
        '--config', '-',
        '--digest',
        '--include',
        '--no-buffer',
        '--silent',
        '--connect-timeout', '5',
        '--retry', '10',
        '--retry-all-errors',
        '--retry-delay', '2',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    // El pin valida la identidad del certificado aun cuando sea autofirmado.
    // URL y credenciales viajan por stdin y no aparecen en la lista de procesos.
    child.stdin.end([
        `url = "${curlConfigValue(terminalBaseUrl.toString())}"`,
        `user = "${curlConfigValue(`${username}:${password}`)}"`,
        'insecure',
        `pinnedpubkey = "${curlConfigValue(pinnedKey)}"`,
        '',
    ].join('\n'));

    return child;
}

async function main() {
    const webhookUrl = new URL(requiredEnv('HIKVISION_WEBHOOK_URL'));
    if (webhookUrl.protocol !== 'https:') throw new Error('webhook_https_required');
    const webhookSecret = requiredEnv('HIKVISION_WEBHOOK_SECRET');
    if (webhookSecret.length < 32) throw new Error('webhook_secret_too_short');

    let forwarding = Promise.resolve();
    const parser = new HikvisionAlertStreamParser((contentType, body) => {
        const payload = normalizeBridgePart(contentType, body);
        if (!payload) return;

        forwarding = forwarding.then(async () => {
            try {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${webhookSecret}`,
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(15_000),
                });
                console.info(response.ok ? 'attendance_event_forwarded' : `attendance_webhook_rejected_${response.status}`);
            } catch {
                console.error('attendance_webhook_unreachable');
            }
        });
    });

    const stream = startAlertStream();
    console.info('hikvision_bridge_ready');
    stream.stdout.on('data', (chunk: Buffer) => {
        void parser.push(chunk).catch(() => console.error('attendance_stream_parse_failed'));
    });
    stream.on('exit', code => {
        console.error(code === 0 ? 'hikvision_stream_closed' : 'hikvision_stream_failed');
        process.exitCode = code || 1;
    });

    const stop = () => stream.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
}

const isEntrypoint = process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;

if (isEntrypoint) {
    void main().catch(error => {
        console.error(error instanceof Error ? error.message : 'hikvision_bridge_failed');
        process.exitCode = 1;
    });
}
