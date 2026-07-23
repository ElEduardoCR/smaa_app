import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { supabase } from './supabase';
import type { EmployeePermission, EmployeeRole } from './employees';
import { computeAccessList } from './moduleCatalog';

const secretKey = process.env.SESSION_SECRET || 'smaa-default-secret-key-change-me-in-production';
const encodedKey = new TextEncoder().encode(secretKey);

/**
 * Payload del JWT (lo que se mete en la cookie).
 *
 * `accessList` es la lista compacta de `module:sub` a los que el usuario
 * puede acceder (con cualquier flag activo). Sirve para que el middleware
 * gatee sin ir a la BD en cada request. Tamaño: ~25 chars por entry,
 * típicamente <500 bytes incluso con 15+ permisos.
 *
 * Si `accessList` viene vacío, el middleware trata al usuario como sin
 * acceso a ningún módulo (force re-login en sesiones preexistentes).
 */
export type SessionPayload = {
    employeeId: string;
    username: string;
    fullName: string;
    role: EmployeeRole;
    position: string | null;
    photoUrl: string | null;
    accessList: string;  // "manufacturing:maquinado,manufacturing:soldadura,requisitions:,clients:"
    expiresAt: Date;
};

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
 * Decodifica el JWT, consulta los permisos en la BD y los agrega a la sesión.
 * Esta es la función que páginas/API deberían usar para leer la sesión.
 *
 * Si el JWT no trae `accessList` (sesión pre-existente al upgrade), lo
 * recalculamos a partir de los permisos de la BD.
 */
export async function getSession(): Promise<Session | null> {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('smaa_session')?.value;
    if (!sessionCookie) return null;
    const payload = await decrypt(sessionCookie);
    if (!payload) return null;

    try {
        const { data: perms } = await supabase
            .from('employee_permissions')
            .select('*')
            .eq('employee_id', payload.employeeId);
        const permsList = (perms || []) as EmployeePermission[];
        const accessList = payload.accessList
            ? payload.accessList
            : computeAccessList(permsList).join(',');
        return { ...payload, accessList, permissions: permsList };
    } catch {
        return { ...payload, accessList: payload.accessList || '', permissions: [] };
    }
}

/**
 * Setea la cookie. Acepta `permissions` por compatibilidad (la API route
 * de login los trae), y calcula el `accessList` compacto para el JWT.
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
    const { permissions = [], ...rest } = payload;
    const accessList = computeAccessList(permissions).join(',');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const sessionString = await encrypt({ ...rest, accessList, expiresAt });
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
