import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
    const hex = process.env.TOKEN_ENCRYPTION_KEY;
    if (!hex) throw new Error('TOKEN_ENCRYPTION_KEY no está definida en el entorno');
    const key = Buffer.from(hex, 'hex');
    if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres)');
    return key;
}

// Formato de salida: <ivHex>:<tagHex>:<cipherHex>
export function encryptToken(plain: string): string {
    const key = getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptToken(payload: string): string {
    const key = getKey();
    const [ivHex, tagHex, ctHex] = payload.split(':');
    if (!ivHex || !tagHex || !ctHex) throw new Error('Payload cifrado inválido');
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
    return pt.toString('utf8');
}
