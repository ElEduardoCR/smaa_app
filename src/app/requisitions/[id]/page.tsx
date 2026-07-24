import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import RequisitionDetailClient from './RequisitionDetailClient';

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/requisitions');

    if (!can(session.role, session.permissions, 'requisitions', 'view') && session.role !== 'master') {
        redirect('/?denied=1');
    }

    const { id } = await params;

    const { data: req, error } = await supabase
        .from('requisitions')
        .select(`
            *,
            requester:employees!requisitions_requested_by_fkey(id, full_name, position, photo_url, username),
            purchaser:employees!requisitions_purchased_by_fkey(id, full_name, position, photo_url),
            items:requisition_items(*),
            quotations:requisition_quotations(*),
            suggested_supplier:suppliers(id, business_name)
        `)
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    if (!req) notFound();

    // Permisos de acción
    const isOwner = (req as any).requested_by === session.employeeId;
    const isMaster = session.role === 'master';
    const canPurchase = isMaster || can(session.role, session.permissions, 'requisitions', 'purchase');
    const canCancel = isOwner || canPurchase;

    return (
        <RequisitionDetailClient
            currentUserId={session.employeeId}
            canPurchase={canPurchase && (req as any).status === 'pending'}
            canCancel={canCancel && (req as any).status === 'pending'}
            req={req as any}
        />
    );
}
