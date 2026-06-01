import 'server-only';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';

export type GmailMessageMeta = { id: string; threadId: string };

export type GmailAttachment = {
    filename: string;
    mimeType: string;
    attachmentId: string;
    partId: string;
};

export type GmailMessage = {
    id: string;
    threadId: string;
    internalDate: number; // epoch ms
    from: string;
    subject: string;
    attachments: GmailAttachment[];
};

export async function refreshAccessToken(refreshToken: string): Promise<string> {
    const res = await fetch(OAUTH_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });
    if (!res.ok) throw new Error(`Gmail token refresh falló: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.access_token as string;
}

export async function exchangeCodeForTokens(code: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number; }> {
    const res = await fetch(OAUTH_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
            grant_type: 'authorization_code',
        }),
    });
    if (!res.ok) throw new Error(`Intercambio de code falló: ${res.status} ${await res.text()}`);
    return res.json();
}

export async function getUserEmail(accessToken: string): Promise<string> {
    const res = await fetch(`${GMAIL_API}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Profile falló: ${res.status}`);
    const data = await res.json();
    return data.emailAddress as string;
}

// Query optimizado para facturas: solo correos con adjunto PDF o XML y keywords típicas
export function buildInvoiceQuery(afterDate?: Date, beforeDate?: Date): string {
    const keywords = '(factura OR CFDI OR comprobante OR invoice OR "fiscal digital" OR "comprobante fiscal")';
    const attach = 'has:attachment (filename:pdf OR filename:xml)';
    const after = afterDate ? ` after:${Math.floor(afterDate.getTime() / 1000)}` : '';
    const before = beforeDate ? ` before:${Math.floor(beforeDate.getTime() / 1000)}` : '';
    return `${keywords} ${attach}${after}${before}`;
}

export async function listMessages(accessToken: string, query: string, pageToken?: string): Promise<{ messages: GmailMessageMeta[]; nextPageToken?: string }> {
    const url = new URL(`${GMAIL_API}/messages`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`listMessages falló: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return { messages: data.messages || [], nextPageToken: data.nextPageToken };
}

function decodeHeader(headers: any[], name: string): string {
    const h = headers.find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
    return h?.value || '';
}

function collectAttachments(parts: any[] | undefined, acc: GmailAttachment[] = []): GmailAttachment[] {
    if (!parts) return acc;
    for (const p of parts) {
        if (p.parts) collectAttachments(p.parts, acc);
        const filename: string = p.filename || '';
        const att = p.body?.attachmentId;
        if (filename && att) {
            const lower = filename.toLowerCase();
            if (lower.endsWith('.pdf') || lower.endsWith('.xml')) {
                acc.push({
                    filename,
                    mimeType: p.mimeType || '',
                    attachmentId: att,
                    partId: p.partId,
                });
            }
        }
    }
    return acc;
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
    const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`getMessage falló: ${res.status}`);
    const data = await res.json();
    const headers = data.payload?.headers || [];
    return {
        id: data.id,
        threadId: data.threadId,
        internalDate: parseInt(data.internalDate, 10),
        from: decodeHeader(headers, 'From'),
        subject: decodeHeader(headers, 'Subject'),
        attachments: collectAttachments(data.payload?.parts ? data.payload.parts : [data.payload]),
    };
}

export async function downloadAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer> {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`downloadAttachment falló: ${res.status}`);
    const data = await res.json();
    // Gmail devuelve base64url
    const b64 = (data.data as string).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64');
}
