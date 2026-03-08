import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/session';

// Define which permission string guards which paths
const PROTECTED_ROUTES: Record<string, string[]> = {
    '/purchases': ['purchases', 'master'],
    '/sales': ['sales', 'master'],
    '/settings': ['config', 'master'],
    '/manufacturing/new': ['ot', 'master'],
    '/': ['system', 'master'],
    '/clients': ['system', 'master'],
    '/deliveries': ['system', 'master'],
    '/suppliers': ['system', 'master']
};

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip completely public or internal paths
    if (
        pathname === '/login' ||
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/api/') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    // Manufacturing view (and detail views below it, except 'new') is public
    if (pathname.startsWith('/manufacturing') && !pathname.startsWith('/manufacturing/new')) {
        return NextResponse.next();
    }

    // Check the session
    const sessionCookie = request.cookies.get('voxa_session')?.value;
    const session = await decrypt(sessionCookie);
    const userPermissions = session?.permissions || [];

    let isAuthorized = true;

    // Find if this path requires a specific permission
    for (const [route, requiredPerms] of Object.entries(PROTECTED_ROUTES)) {
        // If it's an exact match or a sub-path of a protected route
        // Note: for '/' we only check exact match to avoid blocking everything unexpectedly if logic fails, 
        // but here we block everything that isn't explicitly public if it falls into a rule.
        if (pathname === route || (pathname.startsWith(route + '/') && route !== '/')) {
            const hasPermission = requiredPerms.some((perm) => userPermissions.includes(perm));
            if (!hasPermission) {
                isAuthorized = false;
                break;
            }
        }
    }

    // Special check for root path (system)
    if (pathname === '/' && !userPermissions.includes('system') && !userPermissions.includes('master')) {
        isAuthorized = false;
    }

    if (!isAuthorized) {
        // Redirect to login, appending the intended destination
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.search = `?redirect=${encodeURIComponent(pathname)}`;
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
