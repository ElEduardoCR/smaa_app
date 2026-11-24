import { requirePermission } from '@/lib/permissionGate';
import AuditClient from './AuditClient';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
    await requirePermission({ moduleCode: 'audit', action: 'view' });
    return <AuditClient />;
}
