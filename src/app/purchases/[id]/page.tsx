import { redirect, notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import PurchaseOrderEditClient from './page.client';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrderEditPage({ params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/purchases');

    // Necesitamos view para entrar; el edit lo controlamos en los botones/acciones.
    if (!can(session.role, session.permissions, 'purchases', 'view') && session.role !== 'master') {
        redirect('/?denied=1');
    }

    const { id } = await params;

    // Cargar PO con supplier e items en paralelo
    const [poRes, itemsRes, suppliersRes] = await Promise.all([
        supabase
            .from('purchase_orders')
            .select('*, supplier:suppliers(id, business_name, rfc)')
            .eq('id', id)
            .maybeSingle(),
        supabase
            .from('purchase_order_items')
            .select('*')
            .eq('purchase_order_id', id)
            .order('created_at', { ascending: true }),
        supabase
            .from('suppliers')
            .select('id, business_name, rfc')
            .order('business_name', { ascending: true }),
    ]);

    if (poRes.error) throw poRes.error;
    if (!poRes.data) notFound();
    if (itemsRes.error) throw itemsRes.error;

    // Permisos de acción
    const canEdit = session.role === 'master' || can(session.role, session.permissions, 'purchases', 'edit');
    const canDelete = session.role === 'master' || can(session.role, session.permissions, 'purchases', 'delete');

    return (
        <PurchaseOrderEditClient
            po={poRes.data as any}
            items={(itemsRes.data || []) as any[]}
            suppliers={(suppliersRes.data || []) as any[]}
            canEdit={canEdit}
            canDelete={canDelete}
            currentUser={{ id: session.employeeId, fullName: session.fullName, role: session.role }}
        />
    );
}
