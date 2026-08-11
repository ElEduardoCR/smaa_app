import { requirePermission } from '@/lib/permissionGate';
import ClientPage from './page.client';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    await requirePermission({ moduleCode: 'document_requests', action: 'view' });
    const { id } = await params;
    return <ClientPage id={id} />;
}
