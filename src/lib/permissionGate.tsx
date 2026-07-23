// ===========================================================================
// Helpers para checar permisos en server components y API routes.
//
// server component (página o layout):
//   import { requirePermission } from '@/lib/permissionGate';
//   export default async function Page() {
//     await requirePermission({ moduleCode: 'sales', action: 'view' });
//     return <MyClient />;
//   }
//
// server action (mutaciones):
//   import { requirePermission } from '@/lib/permissionGate';
//   'use server';
//   export async function deleteSomething(id) {
//     await requirePermission({ moduleCode: 'sales', action: 'delete' });
//     ...
//   }
//
// API route:
//   import { requireApiPermission } from '@/lib/permissionGate';
//   export async function POST(req) {
//     const { error, session } = await requireApiPermission({
//       moduleCode: 'sales', action: 'create'
//     });
//     if (error) return error;
//     ...
//   }
// ===========================================================================

import 'server-only';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getSession } from './session';
import { can, type Action } from './permissions';
import type { EmployeeRole, EmployeePermission } from './employees';

type CheckOpts = {
    moduleCode: string;
    subCode?: string | null;
    action: Action;
    /** A dónde redirigir si el usuario no tiene permiso. Default: '/?denied=1' */
    redirectTo?: string;
};

/**
 * Para usar dentro de server components / server actions.
 * Redirige a login si no hay sesión, o al redirectTo si no tiene permiso.
 * Devuelve la sesión si todo OK, para que el caller pueda usarla.
 */
export async function requirePermission(opts: CheckOpts) {
    const session = await getSession();
    if (!session) {
        redirect('/login');
    }
    if (!can(session.role, session.permissions, opts.moduleCode, opts.action, opts.subCode ?? null)) {
        redirect(opts.redirectTo ?? '/?denied=1');
    }
    return session;
}

type ApiSession = {
    employeeId: string;
    role: EmployeeRole;
    permissions: EmployeePermission[];
    accessList: string;
};

export type ApiAuthResult =
    | { ok: true; session: ApiSession }
    | { ok: false; error: NextResponse };

/**
 * Para API routes. Devuelve `{ ok: true, session }` si todo OK, o
 * `{ ok: false, error: NextResponse }` con el código HTTP apropiado si no.
 *
 *   const auth = await requireApiPermission({ moduleCode: 'sales', action: 'create' });
 *   if (!auth.ok) return auth.error;
 *   // ... usar auth.session
 */
export async function requireApiPermission(opts: CheckOpts): Promise<ApiAuthResult> {
    const session = await getSession();
    if (!session) {
        return { ok: false, error: NextResponse.json({ error: 'No autenticado.' }, { status: 401 }) };
    }
    if (!can(session.role, session.permissions, opts.moduleCode, opts.action, opts.subCode ?? null)) {
        return { ok: false, error: NextResponse.json({ error: 'Sin permiso.' }, { status: 403 }) };
    }
    return {
        ok: true,
        session: {
            employeeId: session.employeeId,
            role: session.role,
            permissions: session.permissions,
            accessList: session.accessList,
        },
    };
}
