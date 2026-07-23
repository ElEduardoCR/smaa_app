import { requirePermission } from '@/lib/permissionGate';
import ClientPage from './page.client';

export const dynamic = 'force-dynamic';

export default async function Page() {
    // Mismo módulo que /changes: documents.
    // Aquí se configura y dispara la sync de GitHub.
    await requirePermission({ moduleCode: 'documents', action: 'edit' });
    return <ClientPage />;
}
