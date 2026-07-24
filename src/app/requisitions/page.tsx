import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import RequisitionsClient from './RequisitionsClient';

export default async function RequisitionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/requisitions');

    if (!can(session.role, session.permissions, 'requisitions', 'view') && session.role !== 'master') {
        redirect('/?denied=1');
    }

    const canCreate = can(session.role, session.permissions, 'requisitions', 'request_supplies') || session.role === 'master';
    const canPurchase = can(session.role, session.permissions, 'requisitions', 'purchase') || session.role === 'master';
    // canViewAll: el permiso para ver requisiciones de OTROS usuarios.
    // Atado a `view` (no a `purchase`) para que un operador con view pueda
    // ver todas las requisiciones del taller, no solo las suyas.
    const canViewAll = can(session.role, session.permissions, 'requisitions', 'view') || session.role === 'master';

    const sp = await searchParams;
    let tab = (sp?.tab as 'mine' | 'pending' | 'all') || 'mine';
    // Gate: si pide pending/all sin view, degradar a mine (defense-in-depth
    // contra manipulación de query string).
    if ((tab === 'pending' || tab === 'all') && !canViewAll) {
        tab = 'mine';
    }

    let q = supabase.from('requisitions')
        .select('id, code, status, priority, needed_by, suggested_supplier_text, notes, created_at, purchased_at, invoice_url, invoice_photo_url, requested_by, items:requisition_items(id), requester:employees!requisitions_requested_by_fkey(id, full_name, position, photo_url)')
        .order('created_at', { ascending: false })
        .limit(500);

    if (tab === 'mine') {
        q = q.eq('requested_by', session.employeeId);
    } else if (tab === 'pending') {
        q = q.eq('status', 'pending');
    }
    // tab === 'all' no filtra

    const { data: rows, error } = await q;
    if (error) console.error('req list error', error);

    // conteos
    const [
        { count: mineTotal },
        { count: minePending },
        { count: allPending },
        { count: allTotal },
    ] = await Promise.all([
        supabase.from('requisitions').select('id', { count: 'exact', head: true }).eq('requested_by', session.employeeId),
        supabase.from('requisitions').select('id', { count: 'exact', head: true }).eq('requested_by', session.employeeId).eq('status', 'pending'),
        supabase.from('requisitions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('requisitions').select('id', { count: 'exact', head: true }),
    ]);

    return (
        <RequisitionsClient
            currentUserId={session.employeeId}
            canCreate={canCreate}
            canPurchase={canPurchase}
            canViewAll={canViewAll}
            initialTab={tab}
            counts={{ mineTotal: mineTotal || 0, minePending: minePending || 0, allPending: allPending || 0, allTotal: allTotal || 0 }}
            initialRows={(rows || []) as any}
        />
    );
}
