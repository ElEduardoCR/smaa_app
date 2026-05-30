import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { decryptToken } from './crypto';
import {
    refreshAccessToken,
    buildInvoiceQuery,
    listMessages,
    getMessage,
    downloadAttachment,
    GmailMessage,
    GmailAttachment,
} from './gmail';
import { parseCFDI, CfdiData } from './cfdi';
import { classifyInvoiceWithHaiku } from './classifyInvoice';

const BUCKET = 'purchase_files';
const INBOX_PREFIX = 'invoice_inbox';

export function getServerSupabase(): SupabaseClient {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
}

export type SyncOptions = {
    integrationId: string;
    afterDate?: Date;                     // límite inferior (para backfill)
    maxMessages?: number;                 // tope de seguridad
};

export type SyncResult = {
    scanned: number;
    inserted: number;
    skipped: number;
    errors: { messageId: string; error: string }[];
};

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

async function uploadToStorage(supabase: SupabaseClient, path: string, buffer: Buffer, contentType: string): Promise<string> {
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType, upsert: false });
    if (error) throw new Error(`Upload ${path}: ${error.message}`);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

async function getIntegration(supabase: SupabaseClient, id: string) {
    const { data, error } = await supabase
        .from('email_integrations')
        .select('*')
        .eq('id', id)
        .single();
    if (error) throw new Error(`Integration ${id}: ${error.message}`);
    return data;
}

export async function runEmailSync(opts: SyncOptions): Promise<SyncResult> {
    const supabase = getServerSupabase();
    const integration = await getIntegration(supabase, opts.integrationId);

    await supabase
        .from('email_integrations')
        .update({ last_sync_status: 'running', last_sync_error: null })
        .eq('id', integration.id);

    const result: SyncResult = { scanned: 0, inserted: 0, skipped: 0, errors: [] };

    try {
        const refreshToken = decryptToken(integration.refresh_token_encrypted);
        const accessToken = await refreshAccessToken(refreshToken);

        const afterDate = opts.afterDate
            ?? (integration.last_sync_at ? new Date(integration.last_sync_at) : undefined);
        const query = buildInvoiceQuery(afterDate);

        let pageToken: string | undefined = undefined;
        const max = opts.maxMessages ?? 2000;

        outer: do {
            const { messages, nextPageToken } = await listMessages(accessToken, query, pageToken);
            pageToken = nextPageToken;

            for (const meta of messages) {
                if (result.scanned >= max) break outer;
                result.scanned++;

                try {
                    // Idempotencia: skip si ya existe el message_id
                    const { data: existing } = await supabase
                        .from('invoice_inbox')
                        .select('id')
                        .eq('integration_id', integration.id)
                        .eq('email_message_id', meta.id)
                        .maybeSingle();
                    if (existing) { result.skipped++; continue; }

                    const msg = await getMessage(accessToken, meta.id);
                    if (msg.attachments.length === 0) { result.skipped++; continue; }

                    const inserted = await processMessage(supabase, accessToken, integration.id, msg);
                    if (inserted) result.inserted++; else result.skipped++;
                } catch (e: any) {
                    result.errors.push({ messageId: meta.id, error: e.message });
                }
            }
        } while (pageToken && result.scanned < max);

        // Actualiza last_sync_at solo para cron diario (no para backfill arbitrario)
        const now = new Date().toISOString();
        const patch: any = {
            last_sync_status: 'ok',
            last_sync_processed: result.inserted,
            updated_at: now,
        };
        if (!opts.afterDate) patch.last_sync_at = now;
        await supabase.from('email_integrations').update(patch).eq('id', integration.id);

        return result;
    } catch (e: any) {
        await supabase
            .from('email_integrations')
            .update({ last_sync_status: 'error', last_sync_error: e.message })
            .eq('id', integration.id);
        throw e;
    }
}

async function processMessage(
    supabase: SupabaseClient,
    accessToken: string,
    integrationId: string,
    msg: GmailMessage
): Promise<boolean> {
    const xmlAtt = msg.attachments.find(a => a.filename.toLowerCase().endsWith('.xml'));
    const pdfAtt = msg.attachments.find(a => a.filename.toLowerCase().endsWith('.pdf'));

    let cfdi: CfdiData | null = null;
    let xmlUrl: string | undefined;
    let pdfUrl: string | undefined;

    if (xmlAtt) {
        const xmlBuf = await downloadAttachment(accessToken, msg.id, xmlAtt.attachmentId);
        const xmlStr = xmlBuf.toString('utf8');
        cfdi = parseCFDI(xmlStr);
        if (cfdi.isCfdi) {
            const path = `${INBOX_PREFIX}/${msg.id}/${sanitizeFilename(xmlAtt.filename)}`;
            xmlUrl = await uploadToStorage(supabase, path, xmlBuf, 'application/xml');
        } else {
            cfdi = null; // XML no era CFDI
        }
    }

    let aiResult: Awaited<ReturnType<typeof classifyInvoiceWithHaiku>> | null = null;
    let pdfBuf: Buffer | null = null;
    if (pdfAtt) {
        pdfBuf = await downloadAttachment(accessToken, msg.id, pdfAtt.attachmentId);
    }

    // Si no hay CFDI parseable, usar Haiku
    if (!cfdi) {
        aiResult = await classifyInvoiceWithHaiku({
            from: msg.from,
            subject: msg.subject,
            pdfBase64: pdfBuf ? pdfBuf.toString('base64') : undefined,
        });
        if (!aiResult.is_invoice || (aiResult.confidence ?? 0) < 0.5) {
            return false;
        }
    }

    if (pdfBuf && pdfAtt) {
        const path = `${INBOX_PREFIX}/${msg.id}/${sanitizeFilename(pdfAtt.filename)}`;
        pdfUrl = await uploadToStorage(supabase, path, pdfBuf, 'application/pdf');
    }

    const row: any = {
        integration_id: integrationId,
        email_message_id: msg.id,
        email_from: msg.from,
        email_subject: msg.subject,
        email_date: new Date(msg.internalDate).toISOString(),
        pdf_url: pdfUrl,
        xml_url: xmlUrl,
        is_invoice: true,
        status: 'pending',
    };

    if (cfdi) {
        row.detected_source = 'cfdi';
        row.supplier_rfc = cfdi.emisor_rfc;
        row.supplier_name = cfdi.emisor_nombre;
        row.receiver_rfc = cfdi.receptor_rfc;
        row.invoice_uuid = cfdi.uuid;
        row.invoice_folio = cfdi.folio;
        row.invoice_date = cfdi.fecha ? new Date(cfdi.fecha).toISOString() : null;
        row.subtotal = cfdi.subtotal;
        row.vat_total = cfdi.iva;
        row.total = cfdi.total;
        row.currency = cfdi.moneda || 'MXN';
        row.line_items = cfdi.conceptos;
    } else if (aiResult) {
        row.detected_source = 'ai';
        row.classification_confidence = aiResult.confidence;
        row.classification_notes = aiResult.notes;
        row.supplier_rfc = aiResult.supplier_rfc;
        row.supplier_name = aiResult.supplier_name;
        row.invoice_folio = aiResult.invoice_folio;
        row.invoice_date = aiResult.invoice_date ? new Date(aiResult.invoice_date).toISOString() : null;
        row.subtotal = aiResult.subtotal;
        row.vat_total = aiResult.vat_total;
        row.total = aiResult.total;
        row.currency = aiResult.currency || 'MXN';
    }

    // Duplicado por UUID CFDI
    if (row.invoice_uuid) {
        const { data: dup } = await supabase
            .from('invoice_inbox')
            .select('id')
            .eq('invoice_uuid', row.invoice_uuid)
            .maybeSingle();
        if (dup) {
            row.status = 'duplicate';
        }
    }

    const { error } = await supabase.from('invoice_inbox').insert(row);
    if (error) throw new Error(`insert inbox: ${error.message}`);
    return true;
}
