import 'server-only';
import { getServerSupabase } from '@/lib/supabaseServer';

// ===========================================================================
// Acceso al bucket PRIVADO del expediente.
//
// A diferencia del resto de los buckets del proyecto, employee_files no es
// público y no tiene policies para anon: lleva INE, CURP, actas y documentos
// médicos. Nada de aquí sale como URL permanente — se firma en el momento,
// desde una server action que ya verificó permisos.
// ===========================================================================

export const EMPLOYEE_BUCKET = 'employee_files';

/** Vida de las URLs firmadas. Corta a propósito: son para ver o descargar ya. */
export const SIGNED_URL_TTL_SECONDS = 300;

const MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

export function sanitizeFileName(name: string): string {
    const cleaned = name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(-120);
    return cleaned || 'archivo';
}

/** Ruta determinística: employees/<employee_id>/<tipo>/<timestamp>-<nombre> */
export function buildStoragePath(
    employeeId: string, typeCode: string, fileName: string,
): string {
    return `employees/${employeeId}/${typeCode}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

export type UploadInput = {
    employeeId: string;
    typeCode: string;
    fileName: string;
    contentType: string;
    /** Contenido del archivo en base64 (sin el prefijo data:). */
    base64: string;
};

export type UploadedFile = {
    path: string;
    fileName: string;
    contentType: string;
    size: number;
};

export async function uploadEmployeeFile(input: UploadInput): Promise<UploadedFile> {
    const contentType = (input.contentType || '').toLowerCase().split(';')[0].trim();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new Error(
            `Tipo de archivo no permitido (${contentType || 'desconocido'}). ` +
            'El expediente acepta PDF e imágenes (JPG, PNG, WEBP, HEIC).',
        );
    }

    const buffer = Buffer.from(input.base64, 'base64');
    if (buffer.length === 0) throw new Error('El archivo llegó vacío.');
    if (buffer.length > MAX_BYTES) {
        throw new Error(
            `El archivo pesa ${(buffer.length / 1024 / 1024).toFixed(1)} MB y el máximo son 25 MB.`,
        );
    }

    const path = buildStoragePath(input.employeeId, input.typeCode, input.fileName);
    const db = getServerSupabase();
    const { error } = await db.storage
        .from(EMPLOYEE_BUCKET)
        .upload(path, buffer, { contentType, upsert: false });
    if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);

    return {
        path,
        fileName: sanitizeFileName(input.fileName),
        contentType,
        size: buffer.length,
    };
}

/** URL firmada de vida corta. Nunca guardar el resultado en la base. */
export async function signEmployeeFile(path: string, download = false): Promise<string> {
    const db = getServerSupabase();
    const { data, error } = await db.storage
        .from(EMPLOYEE_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, download ? { download: true } : undefined);
    if (error || !data?.signedUrl) {
        throw new Error(`No se pudo generar el enlace: ${error?.message ?? 'sin URL'}`);
    }
    return data.signedUrl;
}

export async function removeEmployeeFile(path: string): Promise<void> {
    const db = getServerSupabase();
    const { error } = await db.storage.from(EMPLOYEE_BUCKET).remove([path]);
    if (error) throw new Error(`No se pudo borrar el archivo: ${error.message}`);
}
