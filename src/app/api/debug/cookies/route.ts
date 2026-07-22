import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * Endpoint TEMPORAL de diagnóstico.
 * GET /api/debug/cookies → devuelve las cookies recibidas y, si hay smaa_session,
 * intenta decodificarla para confirmar que el JWT se verifica con SESSION_SECRET.
 *
 * No expone secretos: solo dice "presente" / "válida" / "inválida" + claims no sensibles.
 */
export async function GET() {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();
    const sessionCookie = cookieStore.get('smaa_session')?.value;

    // Importación dinámica para no introducir un import estático a `jose` aquí.
    let sessionInfo: any = { present: !!sessionCookie };
    if (sessionCookie) {
        try {
            const { jwtVerify } = await import('jose');
            const secret = process.env.SESSION_SECRET || 'smaa-default-secret-key-change-me-in-production';
            const key = new TextEncoder().encode(secret);
            const { payload } = await jwtVerify(sessionCookie, key, { algorithms: ['HS256'] });
            sessionInfo = {
                present: true,
                valid: true,
                employeeId: payload.employeeId,
                username: payload.username,
                role: payload.role,
                fullName: payload.fullName,
                exp: payload.exp,
                iat: payload.iat,
                permsCount: Array.isArray(payload.permissions) ? payload.permissions.length : 0,
            };
        } catch (e: any) {
            sessionInfo = { present: true, valid: false, error: e?.message || String(e) };
        }
    }

    return NextResponse.json({
        ok: true,
        env: {
            hasSessionSecret: !!process.env.SESSION_SECRET,
            sessionSecretLength: (process.env.SESSION_SECRET || '').length,
            sessionSecretPrefix: (process.env.SESSION_SECRET || '').slice(0, 6),
            nodeEnv: process.env.NODE_ENV,
        },
        cookies: all.map((c) => ({
            name: c.name,
            valueLength: c.value?.length || 0,
            valuePrefix: (c.value || '').slice(0, 12),
        })),
        smaa_session: sessionInfo,
    });
}
