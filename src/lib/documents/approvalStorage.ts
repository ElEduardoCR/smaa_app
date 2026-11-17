import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServerSupabase } from '@/lib/supabaseServer';

const BUCKET = 'controlled-document-signatures';
const PREFIX = `storage://${BUCKET}/`;

/** Called only after a server action has authorized the current employee. */
export async function storeControlledSignature(dataUrl: string, ownerId: string) {
    if (typeof dataUrl !== 'string' || dataUrl.length > 400_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
        throw new Error('Dibuja una firma válida.');
    }
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 4096 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 2048) {
        throw new Error('La imagen de firma no es válida.');
    }
    const path = `${ownerId}/${randomUUID()}.png`;
    const { error } = await getServerSupabase().storage.from(BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: false, cacheControl: '0' });
    if (error) throw new Error('No se pudo guardar la firma de forma privada.');
    return `${PREFIX}${path}`;
}

export async function signControlledSignature(uri: string | null): Promise<string | null> {
    if (!uri || !uri.startsWith(PREFIX)) return uri;
    const path = uri.slice(PREFIX.length);
    if (!/^[a-zA-Z0-9/_-]+\.png$/.test(path) || path.includes('..')) throw new Error('Referencia de firma no válida.');
    const { data, error } = await getServerSupabase().storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw new Error('No se pudo abrir la firma de aprobación.');
    return data.signedUrl;
}

export async function removeUncommittedControlledSignature(uri: string) {
    if (!uri.startsWith(PREFIX)) return;
    const db = getServerSupabase();
    const [documents, signatures, requests] = await Promise.all([
        db.from('documents').select('id').eq('approval_signature_url', uri).limit(1),
        db.from('document_signatures').select('id').eq('signature_url', uri).limit(1),
        db.from('document_requests').select('id').eq('top_mgmt_signature_url', uri).limit(1),
    ]);
    // A failed network response can follow a committed transaction. Never
    // remove evidence when the database already references it or cannot verify.
    if ([documents, signatures, requests].some(result => result.error || result.data?.length)) return;
    await db.storage.from(BUCKET).remove([uri.slice(PREFIX.length)]);
}
