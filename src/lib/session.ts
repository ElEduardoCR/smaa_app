import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { supabase } from './supabase';
import type { EmployeePermission, EmployeeRole } from './employees';

const secretKey = process.env.SESSION_SECRET || 'smaa-default-secret-key-change-me-in-production';
const encodedKey = new TextEncoder().encode(secretKey);

/**
 * Lo que se mete en el JWT de la cookie. NO incluye permisos: si los
 * metiéramos, el JWT crece linealmente con el número de permisos y supera
 * el límite de 4KB de las cookies del navegador (caso real: 7 permisos ya
 * ocupaban 4,088 bytes y el navegador rechazaba la Set-Cookie silenciosamente).
 *
 * Los permisos se consultan a la BD cada vez que se necesitan (en `getSession`).
 */
export type SessionPayload = {
    employeeId: string;
    username: string;
    fullName: string;
    role: EmployeeRole;
    position: string | null;
    photoUrl: string | null;
    expiresAt: Date;
};

/** Lo que devuelven `getSession` / `setSession` a las páginas: payload + permisos en vivo. */
export type Session = SessionPayload & { permissions: EmployeePermission[] };

export async function encrypt(payload: SessionPayload) {
    return new SignJWT(payload as any)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(encodedKey);
}

export async function decrypt(session: string | undefined = ''): Promise<SessionPayload | null> {
    try {
        const { payload } = await jwtVerify(session, encodedKey, {
            algorithms: ['HS256'],
        });
        return payload as unknown as SessionPayload;
    } catch (error) {
        return null;
    }
}

/**
 * Decodifica el JWT y consulta los permisos en la BD.
 * Devuelve null si no hay cookie o el JWT no es válido.
 *
 * Es la única función que las páginas/API deberían usar para leer la sesión.
 */
export async function getSession(): Promise<Session | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('smaa_session')?.value;
    if (!sessionCookie) return null;
    const payload = await decrypt(sessionCookie);
    if (!payload) return null;

    // Permisos siempre desde la BD — el JWT ya no los carga.
    // Si falla la query, devolvemos la sesión con [] permisos; las páginas
    // que filtren con `can()` van a tratar al usuario como sin permisos en
    // esos módulos (fail-closed), que es el comportamiento seguro.
    try {
        const { data: perms } = await supabase
            .from('employee_permissions')
            .select('*')
            .eq('employee_id', payload.employeeId);
        return { ...payload, permissions: (perms || []) as EmployeePermission[] };
    } catch {
        return { ...payload, permissions: [] };
    }
}

/**
 * Setea la cookie con un JWT minimal. `permissions` se acepta por
 * compatibilidad (la API route la pasa), pero NO se mete al JWT.
 */
export async function setSession(payload: {
    employeeId: string;
    username: string;
    fullName: string;
    role: EmployeeRole;
    position: string | null;
    photoUrl: string | null;
    permissions?: EmployeePermission[];
}) {
    const { permissions: _ignored, ...jwtPayload } = payload;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const sessionString = await encrypt({ ...(jwtPayload as any), expiresAt });
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
