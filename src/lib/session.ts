import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secretKey = process.env.SESSION_SECRET || 'smaa-default-secret-key-change-me-in-production';
const encodedKey = new TextEncoder().encode(secretKey);

export type SessionPayload = {
    permissions: string[]; // e.g. ['system', 'purchases', 'sales', 'config', 'ot', 'master']
    expiresAt: Date;
};

export async function encrypt(payload: SessionPayload) {
    return new SignJWT(payload as any)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(encodedKey);
}

export async function decrypt(session: string | undefined = '') {
    try {
        const { payload } = await jwtVerify(session, encodedKey, {
            algorithms: ['HS256'],
        });
        return payload as unknown as SessionPayload;
    } catch (error) {
        return null;
    }
}

export async function getSession() {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('smaa_session')?.value;
    if (!sessionCookie) return null;
    return await decrypt(sessionCookie);
}

export async function updateSession(newPermissions: string[]) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Get existing permissions and merge
    const session = await getSession();
    const currentPermissions = session?.permissions || [];

    // Unique permissions
    const permissions = Array.from(new Set([...currentPermissions, ...newPermissions]));

    const sessionData: SessionPayload = {
        permissions,
        expiresAt,
    };

    const sessionString = await encrypt(sessionData);

    const cookieStore = await cookies();
    cookieStore.set('smaa_session', sessionString, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        expires: expiresAt,
        sameSite: 'lax',
        path: '/',
    });
}

export async function destroySession() {
    const cookieStore = await cookies();
    cookieStore.delete('smaa_session');
}
