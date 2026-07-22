import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';
import { resolvePermission } from '@/lib/permissions';

// module_code por ruta + acción mínima requerida + (opcional) cómo extraer sub_code
const PROTECTED_ROUTES: Array<{
    match: (pathname: string) => boolean;
    moduleCode: string;
    action: 'view' | 'create' | 'edit' | 'delete' | 'start' | 'pause' | 'complete' | 'request_supplies' | 'purchase';
    getSubCode?: (pathname: string) => string | null;
}> = [
    { match: (p) => p === '/',                                   moduleCode: 'dashboard',    action: 'view' },
    { match: (p) => p === '/dashboard',                          moduleCode: 'dashboard',    action: 'view' },
    { match: (p) => p.startsWith('/clients'),                    moduleCode: 'clients',      action: 'view' },
    { match: (p) => p.startsWith('/sales'),                      moduleCode: 'sales',        action: 'view' },
    { match: (p) => p.startsWith('/purchases'),                  moduleCode: 'purchases',    action: 'view' },
    { match: (p) => p.startsWith('/suppliers'),                  moduleCode: 'suppliers',    action: 'view' },
    { match: (p) => p.startsWith('/deliveries'),                 moduleCode: 'deliveries',   action: 'view' },
    { match: (p) => p.startsWith('/finance'),                    moduleCode: 'finance',      action: 'view' },
    { match: (p) => p.startsWith('/quality'),                    moduleCode: 'quality',      action: 'view' },
    { match: (p) => p.startsWith('/documents'),                  moduleCode: 'documents',    action: 'view' },
    { match: (p) => p.startsWith('/changes'),                    moduleCode: 'documents',    action: 'view' },
    { match: (p) => p.startsWith('/settings'),                   moduleCode: 'settings',     action: 'view' },
    { match: (p) => p.startsWith('/requisitions'),               moduleCode: 'requisitions', action: 'view' },
    { match: (p) => p.startsWith('/settings/employees'),         moduleCode: 'employees',    action: 'view' },

    // manufacturing — sub_code = code del módulo
    { match: (p) => p === '/manufacturing',                      moduleCode: 'manufacturing', action: 'view' },
    { match: (p) => p === '/manufacturing/new',                  moduleCode: 'manufacturing', action: 'create' },
    {
        match: (p) => /^\/manufacturing\/[^/]+(\/.*)?$/.test(p),
        moduleCode: 'manufacturing',
        action: 'view',
        getSubCode: (p) => p.split('/')[2] || null,
    },
];

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

    // Buscar la regla que aplique
    for (const rule of PROTECTED_ROUTES) {
        if (!rule.match(pathname)) continue;

        const sub = rule.getSubCode ? rule.getSubCode(pathname) : null;
        const p = resolvePermission(session.permissions, rule.moduleCode, sub);

        let allowed = false;
        if (p) {
            switch (rule.action) {
                case 'view':             allowed = p.can_view; break;
                case 'create':           allowed = p.can_create; break;
                case 'edit':             allowed = p.can_edit; break;
                case 'delete':           allowed = p.can_delete; break;
                case 'start':            allowed = p.can_start; break;
                case 'pause':            allowed = p.can_pause; break;
                case 'complete':         allowed = p.can_complete; break;
                case 'request_supplies': allowed = p.can_request_supplies; break;
                case 'purchase':         allowed = p.can_purchase; break;
            }
        }

        if (!allowed) {
            const url = request.nextUrl.clone();
            url.pathname = '/login';
            url.search = `?redirect=${encodeURIComponent(pathname)}&denied=1`;
            return NextResponse.redirect(url);
        }
        // regla aplicada: ya validamos, dejamos pasar
        return NextResponse.next();
    }

    // Si la ruta no está en PROTECTED_ROUTES pero hay session, dejamos pasar
    // (páginas públicas o futuras)
    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
