import { requirePermission } from '@/lib/permissionGate';
import ClientPage from './page.client';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
    await requirePermission({ moduleCode: 'finance', subCode: 'receivable', action: 'view' });
    const { clientId } = await params;
    return <ClientPage clientId={clientId} />;
}
