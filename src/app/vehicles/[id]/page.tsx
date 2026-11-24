import { requirePermission } from '@/lib/permissionGate';
import VehicleDetail from './VehicleDetail';

export const dynamic = 'force-dynamic';

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
    await requirePermission({ moduleCode: 'vehicles', action: 'view' });
    const { id } = await params;
    return <VehicleDetail vehicleId={id} />;
}
