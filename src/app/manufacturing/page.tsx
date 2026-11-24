import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can, canCreateAnywhereInModule, canViewModule } from '@/lib/permissions';
import { getSubCodes } from '@/lib/moduleCatalog';
import WorkOrdersList from './WorkOrdersList';

export const dynamic = 'force-dynamic';

export default async function ManufacturingPage({ searchParams }: { searchParams: Promise<{ proceso?: string }> }) {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/manufacturing');
    const canQuality = can(session.role, session.permissions, 'quality', 'view');
    if (!canViewModule(session.role, session.permissions, 'manufacturing') && !canQuality) redirect('/?denied=1');

    // Una sola lista: cada quien ve las OT que pasan por algún proceso que
    // tiene asignado. Calidad ve todas.
    const processes = session.role === 'master' || canQuality
        ? getSubCodes('manufacturing')
        : getSubCodes('manufacturing').filter((code) => can(session.role, session.permissions, 'manufacturing', 'view', code));
    const { proceso } = await searchParams;

    return (
        <WorkOrdersList
            processes={processes}
            initialProcess={proceso && processes.includes(proceso) ? proceso : 'all'}
            canCreate={canCreateAnywhereInModule(session.role, session.permissions, 'manufacturing')}
        />
    );
}
