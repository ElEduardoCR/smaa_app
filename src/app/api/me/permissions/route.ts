import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { resolvePermission, type Action } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const url = new URL(req.url);
    const module = url.searchParams.get('module') || '';
    const sub = url.searchParams.get('sub');

    if (session.role === 'master') {
        return NextResponse.json({
            role: 'master',
            module,
            sub: sub || null,
            permissions: {
                can_view: true, can_create: true, can_edit: true, can_delete: true,
                can_start: true, can_pause: true, can_complete: true,
                can_request_supplies: true, can_purchase: true,
            },
        });
    }

    const p = resolvePermission(session.permissions, module, sub);
    return NextResponse.json({
        role: session.role,
        module,
        sub: sub || null,
        permissions: p ? {
            can_view: p.can_view,
            can_create: p.can_create,
            can_edit: p.can_edit,
            can_delete: p.can_delete,
            can_start: p.can_start,
            can_pause: p.can_pause,
            can_complete: p.can_complete,
            can_request_supplies: p.can_request_supplies,
            can_purchase: p.can_purchase,
        } : {
            can_view: false, can_create: false, can_edit: false, can_delete: false,
            can_start: false, can_pause: false, can_complete: false,
            can_request_supplies: false, can_purchase: false,
        },
    });
}
