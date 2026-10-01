import { requirePermission } from '@/lib/permissionGate';
import { can } from '@/lib/permissions';
import ClientPage from './page.client';

export const dynamic = 'force-dynamic';

export default async function Page() {
    const session = await requirePermission({ moduleCode: 'purchases', action: 'view' });
    return (
        <ClientPage
            canEdit={can(session.role, session.permissions, 'purchases', 'edit')}
            canDelete={can(session.role, session.permissions, 'purchases', 'delete')}
        />
    );
}
