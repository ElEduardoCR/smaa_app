import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';
import { getModuleForPath, accessListIncludes, hasSubModules, getSubCodes } from '@/lib/moduleCatalog';

/**
 * Middleware de protección.
 *
 * Estrategia de defensa en profundidad:
 *
 * 1) Rutas públicas (login, assets, API, archivos estáticos) → pasan.
 * 2) Sin sesión → redirige a /login.
 * 3) Master → pasa todo.
 * 4) URL catalogada en MODULE_CATALOG → verifica el accessList del JWT.
 *    Si el usuario no tiene acceso a ese (module, sub), redirige a /?denied=1.
 * 5) URL NO catalogada (página pública, futura, etc.) → pasa, y la página
 *    misma o su layout server-side son responsables de su chequeo fino.
 *
 * Para agregar un módulo nuevo: edita MODULE_CATALOG en src/lib/moduleCatalog.ts
 * con su `routePrefix`. Listo, queda protegido automáticamente.
 */
export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

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

    if (!session) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.search = `?redirect=${encodeURIComponent(pathname)}`;
        return NextResponse.redirect(url);
    }

    // Master bypass total
    if (session.role === 'master') {
        return NextResponse.next();
    }

    // ¿Esta URL corresponde a un módulo conocido?
    const mapping = getModuleForPath(pathname);
    if (!mapping) {
        // URL no catalogada → la página se protege a sí misma
        return NextResponse.next();
    }

    // Check contra el accessList compacto del JWT.
    // Para módulos con sub-módulos (ej. manufacturing), el "raíz" sin sub
    // (subCode=null) se considera accesible si el usuario tiene acceso a
    // CUALQUIER sub-módulo (mismo criterio que canViewModule).
    let hasAccess = accessListIncludes(
        session.accessList,
        mapping.moduleCode,
        mapping.subCode
    );
    if (!hasAccess && !mapping.subCode && hasSubModules(mapping.moduleCode)) {
        // ¿Algún sub de este módulo está accesible?
        const subs = getSubCodes(mapping.moduleCode);
        hasAccess = subs.some((sub) =>
            accessListIncludes(session.accessList, mapping.moduleCode, sub)
        );
    }

    if (!hasAccess) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        url.search = '?denied=1';
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
