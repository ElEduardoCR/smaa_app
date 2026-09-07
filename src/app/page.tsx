import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canViewModule } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { ALL_MODULES } from '@/lib/navModules';
import DashboardClient from './DashboardClient';

export default async function HomePage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/');

    // Filtrar módulos según permisos (master ve todo). canViewModule entiende
    // módulos con sub-módulos: si el usuario puede ver al menos un sub, la
    // tarjeta del módulo padre aparece.
    const visible = ALL_MODULES.filter((m) =>
        canViewModule(session.role, session.permissions, m.moduleCode)
    );

    // Stats rápidas
    const [
        { count: employees },
        { count: otInProgress },
        { count: otInQC },
        { count: docsTotal },
        { data: recentChanges },
        { count: pendingRequisitions },
    ] = await Promise.all([
        supabase.from("employees").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("work_orders").select("id", { count: "exact", head: true }).in("status", ["Open", "In Progress", "Paused"]),
        supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("status", "QC"),
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase.from("change_log").select("changed_at").gte("changed_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("requisitions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    return (
        <DashboardClient
            user={{
                id: session.employeeId,
                fullName: session.fullName,
                username: session.username,
                role: session.role,
                position: session.position,
                photoUrl: session.photoUrl,
            }}
            visibleModules={visible.map(({ moduleCode, subCode, ...rest }) => rest)}
            stats={{
                employees: employees || 0,
                otInProgress: otInProgress || 0,
                otInQC: otInQC || 0,
                docsTotal: docsTotal || 0,
                changesLast7d: recentChanges?.length || 0,
                pendingRequisitions: pendingRequisitions || 0,
            }}
        />
    );
}
