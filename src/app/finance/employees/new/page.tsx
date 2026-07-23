import { requirePermission } from '@/lib/permissionGate';
import ClientPage from './page.client';

export const dynamic = 'force-dynamic';

export default async function Page() {
    await requirePermission({ moduleCode: 'finance', action: 'create' });
    return <ClientPage />;
}
