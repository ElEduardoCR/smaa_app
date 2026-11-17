import 'server-only';
import { getServerSupabase } from '@/lib/supabaseServer';

export const DIGITAL_PDF_BUCKET = 'digital-document-pdfs';

export async function uploadDigitalPdf(path: string, bytes: Buffer, allowExisting = false): Promise<void> {
    if (bytes.length > 25 * 1024 * 1024) throw new Error('El PDF excede el límite de 25 MB. Divide la captura en registros más pequeños.');
    const { error } = await getServerSupabase().storage.from(DIGITAL_PDF_BUCKET).upload(path, bytes, {
        contentType: 'application/pdf', upsert: false, cacheControl: '0',
    });
    if (error && !(allowExisting && (String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message)))) {
        throw new Error(`No se pudo archivar el PDF: ${error.message}`);
    }
}

export async function removeUncommittedDigitalPdf(path: string): Promise<void> {
    const { error } = await getServerSupabase().storage.from(DIGITAL_PDF_BUCKET).remove([path]);
    if (error) throw new Error(`No se pudo retirar el PDF de la captura fallida: ${error.message}`);
}

export async function signDigitalPdf(path: string, filename: string, download = false): Promise<string> {
    const { data, error } = await getServerSupabase().storage.from(DIGITAL_PDF_BUCKET)
        .createSignedUrl(path, 300, download ? { download: filename } : undefined);
    if (error || !data?.signedUrl) throw new Error(`No se pudo abrir el PDF: ${error?.message || 'enlace no disponible'}`);
    return data.signedUrl;
}
