import { NextResponse } from 'next/server';
import { authenticateEmployee } from '@/lib/employees';
import { setSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * Body: { username, password, redirectTo? }
 *
 * Valida credenciales y setea la cookie de sesión. Devuelve JSON con
 * { ok, redirectTo?, user?, error? }. Usado por /login en lugar del server
 * action original porque `cookies().set()` desde un server action
 * prerendered no siempre llega al browser.
 */
export async function POST(req: Request) {
    let body: any;
    try { body = await req.json(); } catch {
        return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
    }

    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const redirectTo = body?.redirectTo ? String(body.redirectTo) : '/';

    if (!username || !password) {
        return NextResponse.json(
            { ok: false, error: 'Selecciona un usuario e ingresa tu contraseña.' },
            { status: 400 }
        );
    }

    let employee;
    try {
        employee = await authenticateEmployee(username, password);
    } catch (err: any) {
        console.error('[api/auth/login] auth error', err);
        return NextResponse.json(
            { ok: false, error: 'Error al validar las credenciales.' },
            { status: 500 }
        );
    }

    if (!employee) {
        return NextResponse.json(
            { ok: false, error: 'Usuario o contraseña incorrectos.' },
            { status: 401 }
        );
    }

    try {
        await setSession({
            employeeId: employee.id,
            username: employee.username,
            fullName: employee.full_name,
            role: employee.role,
            position: employee.position,
            photoUrl: employee.photo_url,
        });
    } catch (err: any) {
        console.error('[api/auth/login] setSession error', err);
        return NextResponse.json(
            { ok: false, error: 'No se pudo iniciar la sesión: ' + (err?.message || 'error') },
            { status: 500 }
        );
    }

    return NextResponse.json({
        ok: true,
        redirectTo,
        user: {
            id: employee.id,
            fullName: employee.full_name,
            username: employee.username,
            role: employee.role,
            position: employee.position,
            photoUrl: employee.photo_url,
        },
    });
}
