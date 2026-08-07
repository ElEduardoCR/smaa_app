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

    // Cabecera de la requisición + sus tablas hijas directas.
    // Importante: NO usamos `!requisitions_purchased_by_fkey` aquí porque
    // si la FK fue renombrada por el self-healing de la migración, esa
    // sintaxis PostgREST lanza un error que revienta el Server Component
    // (mostrándose como "An error occurred in the Server Components render").
    // Mejor: hacer la cabecera plana y los joins a employees por separado.
    const { data: req, error } = await supabase
        .from('requisitions')
        .select(`
            *,
            items:requisition_items(*),
            quotations:requisition_quotations(*),
            suggested_supplier:suppliers(id, business_name)
        `)
        .eq('id', id)
        .maybeSingle();

    if (error) throw error;
    if (!req) notFound();

    // Joins a employees en queries separados (defensivos ante nombres de FK).
    const employeeIds = Array.from(new Set(
        [(req as any).requested_by, (req as any).purchased_by].filter(Boolean)
    ));
    const { data: employees } = employeeIds.length
        ? await supabase
            .from('employees')
            .select('id, full_name, position, photo_url, username')
            .in('id', employeeIds)
        : { data: [] as any[] };

    const empMap = new Map<string, any>((employees || []).map((e: any) => [e.id, e]));
    const requester = empMap.get((req as any).requested_by) || null;
    const purchaser = empMap.get((req as any).purchased_by) || null;

    const enriched = { ...(req as any), requester, purchaser };

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
            req={enriched}
        />
    );
}
