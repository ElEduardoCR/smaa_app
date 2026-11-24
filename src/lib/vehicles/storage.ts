import 'server-only';
import { getServerSupabase } from '@/lib/supabaseServer';
import { safeStorageName } from '@/lib/storageNames';

// ===========================================================================
// Bucket PRIVADO de vehículos (pólizas, tarjetas de circulación, facturas,
// fotos). Igual que el expediente de empleados: el navegador sube directo con
// una URL firmada de carga y sólo ve archivos con URLs firmadas de vida corta.
// ===========================================================================

export const VEHICLE_BUCKET = 'vehicle_files';
export const VEHICLE_SIGNED_URL_TTL_SECONDS = 600;

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

export function normalizeContentType(contentType: string): string {
    return (contentType || '').toLowerCase().split(';')[0].trim();
}

export async function createVehicleUploadUrl(input: { vehicleId: string; kind: string; fileName: string; contentType: string; size: number }) {
    const contentType = normalizeContentType(input.contentType);
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new Error(`Tipo de archivo no permitido (${contentType || 'desconocido'}). Se aceptan PDF e imágenes (JPG, PNG, WEBP, HEIC).`);
    }
    if (!Number.isFinite(input.size) || input.size <= 0) throw new Error('El archivo está vacío.');
    if (input.size > MAX_BYTES) throw new Error(`El archivo pesa ${(input.size / 1024 / 1024).toFixed(1)} MB y el máximo son 25 MB.`);
    const path = `vehicles/${input.vehicleId}/${input.kind}/${Date.now()}-${safeStorageName(input.fileName)}`;
    const { data, error } = await getServerSupabase().storage.from(VEHICLE_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) throw new Error(`No se pudo preparar la carga: ${error?.message ?? 'sin token'}`);
    return { path, token: data.token, contentType };
}

export async function statVehicleFile(path: string): Promise<{ size: number } | null> {
    const slash = path.lastIndexOf('/');
    const { data, error } = await getServerSupabase().storage.from(VEHICLE_BUCKET)
        .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 10 });
    if (error) throw new Error(`No se pudo verificar el archivo: ${error.message}`);
    const object = (data || []).find((o) => o.name === path.slice(slash + 1));
    return object ? { size: Number((object.metadata as { size?: number } | null)?.size ?? 0) } : null;
}

export async function signVehicleFiles(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!paths.length) return out;
    const { data, error } = await getServerSupabase().storage.from(VEHICLE_BUCKET)
        .createSignedUrls(paths, VEHICLE_SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(`No se pudieron generar los enlaces: ${error.message}`);
    (data || []).forEach((item) => { if (item.path && item.signedUrl) out.set(item.path, item.signedUrl); });
    return out;
}

export async function removeVehicleFile(path: string) {
    const { error } = await getServerSupabase().storage.from(VEHICLE_BUCKET).remove([path]);
    if (error) throw new Error(`No se pudo borrar el archivo: ${error.message}`);
}
