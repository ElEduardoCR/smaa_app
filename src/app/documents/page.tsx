import { requirePermission } from '@/lib/permissionGate';
import ClientPage from './page.client';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function Page() {
    const session = await requirePermission({ moduleCode: 'documents', action: 'view' });
    return <ClientPage canCreate={can(session.role, session.permissions, 'documents', 'create')} />;
}
