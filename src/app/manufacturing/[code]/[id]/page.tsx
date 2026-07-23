import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getSubCodes } from '@/lib/moduleCatalog';
import WorkOrderDetail from './WorkOrderDetail';

export const dynamic = 'force-dynamic';

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ code: string; id: string }> }) {
    const { code, id: woId } = await params;
    const session = await getSession();
    if (!session) redirect(`/login?redirect=/manufacturing/${code}/${woId}`);

    if (!getSubCodes('manufacturing').includes(code)) {
        redirect('/manufacturing?denied=1');
    }

    if (!can(session.role, session.permissions, 'manufacturing', 'view', code)) {
        redirect('/manufacturing?denied=1');
    }

    return <WorkOrderDetail code={code} woId={woId} />;
}
