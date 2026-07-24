import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import NewRequisitionClient from './NewRequisitionClient';

export default async function NewRequisitionPage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/requisitions/new');

    if (!can(session.role, session.permissions, 'requisitions', 'request_supplies') && session.role !== 'master') {
        redirect('/?denied=1');
    }

    const { data: suppliers } = await supabase
        .from('suppliers')
        .select('id, business_name, rfc')
        .order('business_name', { ascending: true });

    return (
        <NewRequisitionClient suppliers={(suppliers || []) as any} />
    );
}
