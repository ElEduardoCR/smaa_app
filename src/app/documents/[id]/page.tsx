import { requirePermission } from '@/lib/permissionGate';
import { can } from '@/lib/permissions';
import ClientPage from './page.client';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const session = await requirePermission({ moduleCode: 'documents', action: 'view' });
    // Permisos finos para que el cliente sepa qué botones renderizar.
    // El server (esta función) ya garantizó el view; los siguientes se
    // exponen al cliente para que oculte los controles correspondientes.
    const canEdit = can(session.role, session.permissions, 'documents', 'edit');
    const canDelete = can(session.role, session.permissions, 'documents', 'delete');
    const paramsResolved = await params;
    return <ClientPage id={paramsResolved.id} canEdit={canEdit} canDelete={canDelete} />;
}
