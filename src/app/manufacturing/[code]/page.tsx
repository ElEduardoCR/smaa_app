import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getSubCodes } from '@/lib/moduleCatalog';
import ModuleWorkOrdersList from './ModuleWorkOrdersList';

export const dynamic = 'force-dynamic';

export default async function ModulePage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    const session = await getSession();
    if (!session) redirect(`/login?redirect=/manufacturing/${code}`);

    // code debe ser un sub-módulo válido (maquinado, soldadura, automatizacion)
    if (!getSubCodes('manufacturing').includes(code)) {
        redirect('/manufacturing?denied=1');
    }

    // Permiso de view sobre el sub-módulo específico
    if (!can(session.role, session.permissions, 'manufacturing', 'view', code)) {
        redirect('/manufacturing?denied=1');
    }

    return <ModuleWorkOrdersList code={code} />;
}
