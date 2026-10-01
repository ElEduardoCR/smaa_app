import 'server-only';
import { getServerSupabase } from '@/lib/supabaseServer';
import { safeStorageName } from '@/lib/storageNames';

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
    return safeStorageName(name);
}

/** Ruta determinística: employees/<employee_id>/<tipo>/<timestamp>-<nombre> */
export function buildStoragePath(
    employeeId: string, typeCode: string, fileName: string,
): string {
    return `employees/${employeeId}/${typeCode}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

export type UploadRequest = {
    employeeId: string;
    typeCode: string;
    fileName: string;
    contentType: string;
    size: number;
};

export function normalizeContentType(contentType: string): string {
    return (contentType || '').toLowerCase().split(';')[0].trim();
}

/**
 * Valida y firma una subida directa navegador → bucket privado.
 *
 * El archivo no pasa por el servidor: en Vercel una server action no acepta
 * cuerpos de más de 4.5 MB, y una INE escaneada en base64 ya los rebasa.
 */
export async function createEmployeeUploadUrl(input: UploadRequest): Promise<{ path: string; token: string }> {
    const contentType = normalizeContentType(input.contentType);
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new Error(
            `Tipo de archivo no permitido (${contentType || 'desconocido'}). ` +
            'El expediente acepta PDF e imágenes (JPG, PNG, WEBP, HEIC).',
        );
    }
    if (!Number.isFinite(input.size) || input.size <= 0) throw new Error('El archivo está vacío.');
    if (input.size > MAX_BYTES) {
        throw new Error(
            `El archivo pesa ${(input.size / 1024 / 1024).toFixed(1)} MB y el máximo son 25 MB.`,
        );
    }

    const path = buildStoragePath(input.employeeId, input.typeCode, input.fileName);
    const db = getServerSupabase();
    const { data, error } = await db.storage.from(EMPLOYEE_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) {
        throw new Error(`No se pudo preparar la carga: ${error?.message ?? 'sin token'}`);
    }
    return { path, token: data.token };
}

/** Tamaño real del archivo ya subido, o null si no existe. */
export async function statEmployeeFile(path: string): Promise<{ size: number } | null> {
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const db = getServerSupabase();
    const { data, error } = await db.storage.from(EMPLOYEE_BUCKET).list(dir, { search: name, limit: 10 });
    if (error) throw new Error(`No se pudo verificar el archivo: ${error.message}`);
    const obj = (data || []).find((o) => o.name === name);
    if (!obj) return null;
    return { size: Number((obj.metadata as { size?: number } | null)?.size ?? 0) };
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
