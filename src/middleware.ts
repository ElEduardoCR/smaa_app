import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';

// Desde el refactor de sesiones, el JWT ya no carga permisos (porque con
// 7+ permisos se pasaba del límite de 4KB de las cookies y el navegador
// rechazaba la Set-Cookie silenciosamente). Por eso el middleware solo
// valida "hay sesión" + bypass de master; el chequeo fino de permisos
// lo hace cada página/API con `can()` después de llamar `getSession()`.

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Rutas públicas: el login, assets de Next, API, y archivos estáticos
    if (
        pathname === '/login' ||
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/api/') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    const sessionCookie = request.cookies.get('smaa_session')?.value;
    const session = await decrypt(sessionCookie);

    // Sin sesión válida → a /login
    if (!session) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.search = `?redirect=${encodeURIComponent(pathname)}`;
        return NextResponse.redirect(url);
    }

    // Master pasa todo en el middleware; las páginas de settings/admin
    // también tienen su propio chequeo de role por si acaso.
    if (session.role === 'master') {
        return NextResponse.next();
    }

    // Para roles no-master, dejamos pasar y las páginas/API se encargan
    // del chequeo fino de permisos con `getSession()` + `can()`.
    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
