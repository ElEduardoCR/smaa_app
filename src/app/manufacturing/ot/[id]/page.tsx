import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can, canCreateAnywhereInModule } from '@/lib/permissions';
import { getSubCodes } from '@/lib/moduleCatalog';
import { getServerSupabase } from '@/lib/supabaseServer';
import WorkOrderDetail, { type DetailPermissions } from './WorkOrderDetail';

export const dynamic = 'force-dynamic';

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session) redirect(`/login?redirect=/manufacturing/ot/${id}`);

    const { data: stages } = await getServerSupabase().from('work_order_stages')
        .select('module:manufacturing_modules(code)').eq('work_order_id', id);
    const orderProcesses = (stages || []).map((s) => {
        const moduleRow = Array.isArray(s.module) ? s.module[0] : s.module;
        return moduleRow?.code as string;
    }).filter(Boolean);

    const check = (action: Parameters<typeof can>[3], code: string) => can(session.role, session.permissions, 'manufacturing', action, code);
    const quality = { view: can(session.role, session.permissions, 'quality', 'view'), edit: can(session.role, session.permissions, 'quality', 'edit') };
    // Calidad abre la OT desde su cola aunque no tenga el proceso asignado.
    const canView = session.role === 'master' || quality.view
        || orderProcesses.some((code) => check('view', code))
        || (orderProcesses.length === 0 && getSubCodes('manufacturing').some((code) => check('view', code)));
    if (!canView) redirect('/manufacturing?denied=1');

    const byProcess = Object.fromEntries(getSubCodes('manufacturing').map((code) => [code, {
        view: check('view', code), start: check('start', code), pause: check('pause', code), complete: check('complete', code),
        edit: check('edit', code), delete: check('delete', code), create: check('create', code),
    }]));
    const permissions: DetailPermissions = {
        byProcess,
        quality,
        canEditOrder: session.role === 'master' || orderProcesses.some((code) => check('edit', code)),
        canCancelOrder: session.role === 'master' || orderProcesses.some((code) => check('delete', code)),
        canWarranty: canCreateAnywhereInModule(session.role, session.permissions, 'manufacturing') || quality.edit,
        canCreateDelivery: can(session.role, session.permissions, 'deliveries', 'create'),
        canViewSales: can(session.role, session.permissions, 'sales', 'view'),
    };

    return <WorkOrderDetail woId={id} permissions={permissions} me={{ id: session.employeeId, fullName: session.fullName }} />;
}
