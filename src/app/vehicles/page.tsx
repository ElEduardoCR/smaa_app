import { requirePermission } from '@/lib/permissionGate';
import VehiclesClient from './VehiclesClient';

export const dynamic = 'force-dynamic';

export default async function VehiclesPage() {
    await requirePermission({ moduleCode: 'vehicles', action: 'view' });
    return <VehiclesClient />;
}
