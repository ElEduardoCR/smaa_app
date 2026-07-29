import { NextRequest, NextResponse } from 'next/server';
import { createPublicPromiseAction } from '@/app/actions/ar';

/**
 * POST /api/ar/promise
 * Body: {
 *   token: string,                       // token crudo del share link
 *   selected_invoices: Array<{          // facturas que el cliente quiere pagar
 *     invoice_id: string,
 *     amount_committed: number
 *   }>,
 *   client_notes?: string,
 *   expected_payment_date?: string      // YYYY-MM-DD
 * }
 *
 * Ruta PÚBLICA (no requiere login). La seguridad está en el token: el server
 * action valida que el link exista, no esté revocado y no haya expirado.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
        }
        if (!body.token || typeof body.token !== 'string') {
            return NextResponse.json({ error: 'Token faltante.' }, { status: 400 });
        }
        if (!Array.isArray(body.selected_invoices) || body.selected_invoices.length === 0) {
            return NextResponse.json({ error: 'Selecciona al menos una factura.' }, { status: 400 });
        }
        // Validación ligera de cada item
        for (const item of body.selected_invoices) {
            if (!item.invoice_id || typeof item.invoice_id !== 'string') {
                return NextResponse.json({ error: 'invoice_id inválido.' }, { status: 400 });
            }
            const amt = Number(item.amount_committed);
            if (!isFinite(amt) || amt <= 0) {
                return NextResponse.json({ error: 'amount_committed debe ser > 0.' }, { status: 400 });
            }
        }

        const result = await createPublicPromiseAction({
            token: body.token,
            selected_invoices: body.selected_invoices.map((i: any) => ({
                invoice_id: i.invoice_id,
                amount_committed: Number(i.amount_committed),
            })),
            client_notes: body.client_notes || null,
            expected_payment_date: body.expected_payment_date || null,
        });

        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Error desconocido.' }, { status: 400 });
    }
}
