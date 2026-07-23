import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/emailSync';
import { requireApiPermission } from '@/lib/permissionGate';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const auth = await requireApiPermission({ moduleCode: 'purchases', action: 'edit' });
    if (!auth.ok) return auth.error;

    const body = await req.json().catch(() => ({}));
    const inboxId = body.inboxId as string | undefined;
    if (!inboxId) return NextResponse.json({ error: 'inboxId requerido' }, { status: 400 });

    const supabase = getServerSupabase();

    const { data: inbox, error: getErr } = await supabase
        .from('invoice_inbox')
        .select('*')
        .eq('id', inboxId)
        .single();
    if (getErr || !inbox) return NextResponse.json({ error: 'inbox no encontrado' }, { status: 404 });

    if (inbox.status === 'approved' && inbox.purchase_order_id) {
        return NextResponse.json({ ok: true, alreadyApproved: true, purchaseOrderId: inbox.purchase_order_id });
    }

    if (!inbox.supplier_rfc || !inbox.supplier_name || !inbox.total) {
        return NextResponse.json({ error: 'Faltan datos del proveedor o total para crear la PO' }, { status: 400 });
    }

    // 1) Buscar o crear proveedor por RFC
    let supplierId: string;
    const { data: existingSupplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('rfc', inbox.supplier_rfc)
        .maybeSingle();

    if (existingSupplier) {
        supplierId = existingSupplier.id;
    } else {
        const { data: newSupplier, error: supErr } = await supabase
            .from('suppliers')
            .insert({
                rfc: inbox.supplier_rfc,
                business_name: inbox.supplier_name,
                email: (inbox.email_from || '').match(/<(.+?)>/)?.[1] || null,
            })
            .select('id')
            .single();
        if (supErr || !newSupplier) return NextResponse.json({ error: `Crear proveedor: ${supErr?.message}` }, { status: 500 });
        supplierId = newSupplier.id;
    }

    // 2) Crear PO con status Received (la factura ya llegó)
    const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
            supplier_id: supplierId,
            status: 'Received',
            subtotal: inbox.subtotal || 0,
            vat_total: inbox.vat_total || 0,
            total: inbox.total,
            invoice_url: inbox.pdf_url,
            xml_url: inbox.xml_url,
            invoice_uuid: inbox.invoice_uuid,
            invoice_date: inbox.invoice_date,
            email_message_id: inbox.email_message_id,
            source: 'email',
        })
        .select('id')
        .single();
    if (poErr || !po) return NextResponse.json({ error: `Crear PO: ${poErr?.message}` }, { status: 500 });

    // 3) Items
    const items = Array.isArray(inbox.line_items) ? inbox.line_items : [];
    if (items.length > 0) {
        const rows = items.map((it: any) => ({
            purchase_order_id: po.id,
            description: it.description || 'Sin descripción',
            quantity: Number(it.quantity) || 1,
            unit_price: Number(it.unit_price) || 0,
            line_total: Number(it.line_total) || 0,
        }));
        const { error: itemsErr } = await supabase.from('purchase_order_items').insert(rows);
        if (itemsErr) return NextResponse.json({ error: `Items: ${itemsErr.message}` }, { status: 500 });
    }

    // 4) Marcar inbox como aprobado
    await supabase
        .from('invoice_inbox')
        .update({
            status: 'approved',
            approved_at: new Date().toISOString(),
            purchase_order_id: po.id,
        })
        .eq('id', inboxId);

    return NextResponse.json({ ok: true, purchaseOrderId: po.id });
}
