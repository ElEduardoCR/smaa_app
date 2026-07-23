import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import NewWorkOrderForm from './NewWorkOrderForm';

export const dynamic = 'force-dynamic';

export default async function NewWorkOrderPage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/manufacturing/new');

    // Permiso para crear OT. Se chequea a nivel módulo raíz con sub_code=null
    // porque crear OT no es una acción por sub-módulo — la OT se crea dentro
    // de un módulo específico después, pero el permiso de "poder crear" es
    // sobre el módulo en general.
    if (!can(session.role, session.permissions, 'manufacturing', 'create')) {
        redirect('/?denied=1');
    }

    return <NewWorkOrderForm />;
}
