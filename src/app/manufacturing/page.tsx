import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can, canViewModule, listAccessibleSubCodes } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import ManufacturingIndex from './ManufacturingIndex';

export default async function ManufacturingIndexPage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/manufacturing');

    // canViewModule considera sub-módulos: si el usuario puede ver al menos
    // uno (maquinado/soldadura/automatizacion), dejamos que entre.
    if (!canViewModule(session.role, session.permissions, 'manufacturing')) {
        redirect('/?denied=1');
    }

    // Cargar todos los módulos activos
    const { data: mods, error: mErr } = await supabase
        .from('manufacturing_modules')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
    if (mErr) throw mErr;

    // Filtrar según permisos: master ve todos, otros solo los que tienen permiso view con su sub_code
    const accessibleSubs = listAccessibleSubCodes(session.role, session.permissions, 'manufacturing');
    const canSeeAll = session.role === 'master' || accessibleSubs.length === 0;
    const visibleMods = (mods || []).filter((m: any) => canSeeAll || accessibleSubs.includes(m.code));

    // Si no tiene acceso a ningún sub-módulo, pero sí al módulo completo, mostrar todos
    const finalMods = visibleMods.length > 0 ? visibleMods : (mods || []);

    // Permiso de crear OT
    const canCreateOT = can(session.role, session.permissions, 'manufacturing', 'create');

    // Stats por módulo
    const { data: wos } = await supabase
        .from('work_orders')
        .select('module_id, status');
    const counts: Record<string, any> = {};
    for (const wo of (wos || [])) {
        if (!wo.module_id) continue;
        counts[wo.module_id] = counts[wo.module_id] || { open: 0, inProgress: 0, paused: 0, completed: 0, qc: 0, qcReleased: 0 };
        const b = counts[wo.module_id];
        if (wo.status === 'Open') b.open++;
        else if (wo.status === 'In Progress') b.inProgress++;
        else if (wo.status === 'Paused') b.paused++;
        else if (wo.status === 'Completed') b.completed++;
        else if (wo.status === 'QC') b.qc++;
        else if (wo.status === 'QC_Released') b.qcReleased++;
    }

    const qcQueueCount = (wos || []).filter((w: any) => w.status === 'QC').length;

    return (
        <ManufacturingIndex
            modules={(finalMods as any).map((m: any) => ({
                id: m.id,
                code: m.code,
                name: m.name,
                color: m.color,
                icon: m.icon,
            }))}
            counts={counts}
            qcQueueCount={qcQueueCount}
            canCreateOT={canCreateOT}
            user={{ fullName: session.fullName, role: session.role }}
        />
    );
}
