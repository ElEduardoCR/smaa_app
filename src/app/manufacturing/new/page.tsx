import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canCreateAnywhereInModule } from '@/lib/permissions';
import { listAccessibleSubCodes } from '@/lib/permissions';
import NewWorkOrderForm from './NewWorkOrderForm';

export const dynamic = 'force-dynamic';

export default async function NewWorkOrderPage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/manufacturing/new');

    // Para módulos con sub-módulos (manufacturing → maquinado/soldadura/
    // automatizacion), el permiso `can_create` está guardado por sub. Si
    // el usuario tiene create en al menos un sub, lo dejamos entrar al
    // form; el form después solo le muestra esos subs.
    if (!canCreateAnywhereInModule(session.role, session.permissions, 'manufacturing')) {
        redirect('/?denied=1');
    }

    // Lista de sub-módulos en los que SÍ puede crear (para filtrar el form).
    // master: todos los subs que aparezcan en sus permisos. No-master: solo
    // los que tengan can_create=true.
    const accessibleSubs = session.role === 'master'
        ? listAccessibleSubCodes(session.role, session.permissions, 'manufacturing')
        : session.permissions
            .filter((p) => p.module_code === 'manufacturing' && p.sub_code && p.can_create)
            .map((p) => p.sub_code as string);

    return <NewWorkOrderForm accessibleSubs={accessibleSubs} />;
}
