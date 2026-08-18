import { redirect, notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import RequisitionDetailClient, { type Requisition } from './RequisitionDetailClient';

type EmployeeSummary = {
    id: string;
    full_name: string;
    position: string | null;
    photo_url: string | null;
    username: string;
};

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
    const typedReq = req as unknown as Requisition;

    // Joins a employees en queries separados (defensivos ante nombres de FK).
    const employeeIds = Array.from(new Set(
        [typedReq.requested_by, typedReq.purchased_by].filter((employeeId): employeeId is string => Boolean(employeeId))
    ));
    const { data: employees } = employeeIds.length
        ? await supabase
            .from('employees')
            .select('id, full_name, position, photo_url, username')
            .in('id', employeeIds)
        : { data: [] as EmployeeSummary[] };

    const employeeList = (employees || []) as EmployeeSummary[];
    const empMap = new Map<string, EmployeeSummary>(employeeList.map((employee) => [employee.id, employee]));
    const requester = empMap.get(typedReq.requested_by) || null;
    const purchaser = typedReq.purchased_by ? empMap.get(typedReq.purchased_by) || null : null;

    const enriched: Requisition = { ...typedReq, requester, purchaser };

    // Permisos de acción
    const isOwner = typedReq.requested_by === session.employeeId;
    const isMaster = session.role === 'master';
    const canPurchase = isMaster || can(session.role, session.permissions, 'requisitions', 'purchase');
    const canCancel = isOwner || canPurchase;

    return (
        <RequisitionDetailClient
            canPurchase={canPurchase && typedReq.status === 'pending'}
            canCancel={canCancel && typedReq.status === 'pending'}
            req={enriched}
        />
    );
}
