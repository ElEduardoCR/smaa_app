import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can, canCreateAnywhereInModule, canViewModule } from '@/lib/permissions';
import WarrantiesClient from './WarrantiesClient';

export const dynamic = 'force-dynamic';

export default async function WarrantiesPage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/manufacturing/garantias');
    if (!canViewModule(session.role, session.permissions, 'manufacturing') && !can(session.role, session.permissions, 'quality', 'view')) {
        redirect('/?denied=1');
    }
    const canOpen = canCreateAnywhereInModule(session.role, session.permissions, 'manufacturing')
        || can(session.role, session.permissions, 'quality', 'edit');
    return <WarrantiesClient canOpen={canOpen} />;
}
