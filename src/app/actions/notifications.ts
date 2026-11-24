'use server';

import { getSession, type Session } from '@/lib/session';
import { canViewModule } from '@/lib/permissions';
import { MODULE_CATALOG } from '@/lib/moduleCatalog';
import { getServerSupabase } from '@/lib/supabaseServer';

// ===========================================================================
// Notificaciones (campana del menú). Los avisos los generan triggers de la
// base; aquí se filtran por los módulos que el empleado puede ver, sin los
// que él mismo provocó, y se marcan como leídos.
// ===========================================================================

export type NotificationItem = {
    id: number;
    createdAt: string;
    moduleCode: string;
    event: string;
    title: string;
    body: string | null;
    link: string | null;
    actorName: string | null;
    personal: boolean;
    read: boolean;
};

export type NotificationSummary = { unread: number; items: NotificationItem[] };

function visibleModules(session: Session): string[] {
    return MODULE_CATALOG.map((m) => m.code).filter((code) => canViewModule(session.role, session.permissions, code)
        // Cuentas por cobrar vive como sub-módulo de finanzas.
        || (code === 'finance' && session.permissions.some((p) => p.module_code === 'finance' && p.sub_code === 'receivable' && p.can_view)));
}

/** Filtro PostgREST: avisos de mis módulos (sin destinatario) o dirigidos a mí. */
function audienceFilter(session: Session): string {
    const modules = visibleModules(session);
    const broadcast = modules.length ? `and(recipient_id.is.null,module_code.in.(${modules.join(',')}))` : null;
    return [broadcast, `recipient_id.eq.${session.employeeId}`].filter(Boolean).join(',');
}

export async function getNotificationsAction(options: { limit?: number; beforeId?: number } = {}): Promise<NotificationSummary> {
    const session = await getSession();
    if (!session) return { unread: 0, items: [] };
    const db = getServerSupabase();
    // Vencimientos de vehículos y servicios: a lo más una vez por hora.
    await db.rpc('smaa_generate_scheduled_notifications', { p_force: false });

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const [{ data: state }, { data: reads }] = await Promise.all([
        db.from('notification_state').select('read_all_before').eq('employee_id', session.employeeId).maybeSingle(),
        db.from('notification_reads').select('notification_id').eq('employee_id', session.employeeId)
            .gte('read_at', new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString()),
    ]);
    const readAllBefore = state?.read_all_before ?? null;
    const readIds = new Set((reads || []).map((r) => Number(r.notification_id)));

    let listQuery = db.from('notifications')
        .select('id, created_at, module_code, event, title, body, link, actor_name, actor_id, recipient_id')
        .or(audienceFilter(session))
        .or(`actor_id.is.null,actor_id.neq.${session.employeeId}`)
        .order('id', { ascending: false }).limit(limit);
    if (options.beforeId) listQuery = listQuery.lt('id', options.beforeId);
    let unreadQuery = db.from('notifications').select('id', { count: 'exact' })
        .or(audienceFilter(session))
        .or(`actor_id.is.null,actor_id.neq.${session.employeeId}`)
        .limit(200);
    if (readAllBefore) unreadQuery = unreadQuery.gt('created_at', readAllBefore);

    const [{ data: rows, error }, { data: unreadRows, error: unreadError }] = await Promise.all([listQuery, unreadQuery]);
    if (error) throw new Error(error.message);
    if (unreadError) throw new Error(unreadError.message);

    const isRead = (id: number, createdAt: string) => readIds.has(id) || (!!readAllBefore && createdAt <= readAllBefore);
    return {
        unread: (unreadRows || []).filter((r) => !readIds.has(Number(r.id))).length,
        items: (rows || []).map((row) => ({
            id: Number(row.id),
            createdAt: row.created_at,
            moduleCode: row.module_code,
            event: row.event,
            title: row.title,
            body: row.body,
            link: row.link,
            actorName: row.actor_name,
            personal: !!row.recipient_id,
            read: isRead(Number(row.id), row.created_at),
        })),
    };
}

export async function markNotificationReadAction(id: number) {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    const { error } = await getServerSupabase().from('notification_reads')
        .upsert({ employee_id: session.employeeId, notification_id: id }, { onConflict: 'employee_id,notification_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
}

export async function markAllNotificationsReadAction() {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    const { error } = await getServerSupabase().from('notification_state')
        .upsert({ employee_id: session.employeeId, read_all_before: new Date().toISOString() }, { onConflict: 'employee_id' });
    if (error) throw new Error(error.message);
}
