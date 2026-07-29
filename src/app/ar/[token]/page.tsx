import { resolveShareLinkAction } from '@/app/actions/ar';
import { supabase } from '@/lib/supabase';
import PublicView from './page.client';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    let error: string | null = null;
    let data: any = null;

    try {
        const { client_id, link_id } = await resolveShareLinkAction(token);

        // Cargar datos del cliente
        const { data: client } = await supabase
            .from('clients')
            .select('id, business_name, rfc, email, phone, address, fiscal_zip_code')
            .eq('id', client_id)
            .single();
        if (!client) throw new Error('Cliente no encontrado.');

        // Cargar partidas pendientes/parciales
        const { data: invoices } = await supabase
            .from('ar_invoices')
            .select('id, invoice_number, concept, invoice_date, due_date, gross_amount, vat_amount, net_amount, paid_amount, balance, status')
            .eq('client_id', client_id)
            .eq('is_active', true)
            .in('status', ['pending', 'partial'])
            .order('invoice_date', { ascending: true });

        // Cargar historial de pagos
        const { data: payments } = await supabase
            .from('ar_payments')
            .select('id, payment_date, amount, payment_method, reference, created_at')
            .eq('client_id', client_id)
            .order('payment_date', { ascending: false });

        data = {
            client,
            invoices: invoices || [],
            payments: payments || [],
            link_id,
            token,
        };
    } catch (e: any) {
        error = e.message || 'Error al cargar el estado de cuenta.';
    }

    return <PublicView data={data} error={error} />;
}
