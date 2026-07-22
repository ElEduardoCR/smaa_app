import 'server-only';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// scrypt params (Node default OK values, kept explicit for stability)
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALTLEN = 16;

export function hashPassword(plain: string): string {
    const salt = randomBytes(SALTLEN);
    const derived = scryptSync(plain.normalize('NFKC'), salt, KEYLEN, { N, r, p });
    return [
        'scrypt',
        `n=${N},r=${r},p=${p}`,
        salt.toString('base64'),
        derived.toString('base64'),
    ].join('$');
}

export function verifyPassword(plain: string, stored: string): boolean {
    if (!stored || !stored.startsWith('scrypt$')) return false;
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const [, , saltB64, hashB64] = parts;
    try {
        const salt = Buffer.from(saltB64, 'base64');
        const expected = Buffer.from(hashB64, 'base64');
        const derived = scryptSync(plain.normalize('NFKC'), salt, expected.length, { N, r, p });
        if (derived.length !== expected.length) return false;
        return timingSafeEqual(derived, expected);
    } catch {
        return false;
    }
}
