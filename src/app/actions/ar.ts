'use server';

/**
 * ============================================================================
 * Server actions para Cuentas por Cobrar (AR / Accounts Receivable)
 * ============================================================================
 *
 * Permisos (módulo 'finance', sub 'receivable'):
 *   - view   → ver dashboard, detalle, PDF, links
 *   - create → crear facturas, registrar pagos, generar link
 *   - edit   → editar facturas
 *   - delete → obsoletar/anular facturas, revocar links
 *
 * Master bypass total (revisado en middleware).
 *
 * Reglas de negocio:
 *   - IVA siempre 16% (se calcula server-side, no se confía en el cliente)
 *   - gross → vat = gross * 0.16, net = gross + vat
 *   - status se actualiza automáticamente al insertar allocations (trigger)
 *   - share_link: solo guardamos el SHA-256 del token, nunca el token crudo
 *   - las promesas se crean desde /api/ar/promise (público) con validación de token
 * ============================================================================
 */

import { revalidatePath } from 'next/cache';
import { createHash, randomBytes } from 'crypto';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

// ============================================================================
// Helpers internos
// ============================================================================

const VAT_RATE = 0.16; // 16% — único, configurable solo aquí

function computeVat(gross: number): { vat: number; net: number } {
    const vat = Math.round(gross * VAT_RATE * 100) / 100;
    const net = Math.round((gross + vat) * 100) / 100;
    return { vat, net };
}

async function requireFinanceAR(action: 'view' | 'create' | 'edit' | 'delete') {
    const session = await getSession();
    if (!session) throw new Error('No hay sesión.');
    if (session.role === 'master') return session;
    if (!can(session.role, session.permissions, 'finance', action, 'receivable')) {
        throw new Error(`Sin permiso para ${action} en Cuentas por Cobrar.`);
    }
    return session;
}

function genToken(): { raw: string; hash: string } {
    // 32 bytes → 43 chars base64url. Suficiente entropía para share links.
    const raw = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
}

function hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

// ============================================================================
// Facturas (ar_invoices)
// ============================================================================

export type ARInvoiceInput = {
    client_id: number;
    concept: string;
    gross_amount: number;
    invoice_number?: string | null;
    work_date?: string | null;     // YYYY-MM-DD
    invoice_date?: string | null;  // YYYY-MM-DD, default = hoy
    due_date?: string | null;
    notes?: string | null;
    source_type?: 'manual' | 'issued_cfdi' | 'sale';
    source_id?: string | null;
};

export async function createARInvoiceAction(input: ARInvoiceInput) {
    const session = await requireFinanceAR('create');
    if (!input.client_id) throw new Error('Falta el cliente.');
    if (!input.concept?.trim()) throw new Error('Falta el concepto.');
    const gross = Number(input.gross_amount);
    if (!isFinite(gross) || gross < 0) throw new Error('Monto (bruto) inválido.');
    const { vat, net } = computeVat(gross);

    const row = {
        client_id: input.client_id,
        concept: input.concept.trim(),
        gross_amount: gross,
        vat_amount: vat,
        net_amount: net,
        invoice_number: input.invoice_number?.trim() || null,
        work_date: input.work_date || null,
        invoice_date: input.invoice_date || new Date().toISOString().slice(0, 10),
        due_date: input.due_date || null,
        notes: input.notes?.trim() || null,
        source_type: input.source_type || 'manual',
        source_id: input.source_id || null,
        status: 'pending' as const,
        created_by: session.employeeId,
        updated_by: session.employeeId,
    };

    const { data, error } = await supabase
        .from('ar_invoices')
        .insert(row)
        .select('id')
        .single();
    if (error) throw new Error('Error al crear la partida: ' + error.message);

    revalidatePath('/finance/receivable');
    revalidatePath(`/finance/receivable/${input.client_id}`);
    return { id: data.id };
}

export async function updateARInvoiceAction(id: string, input: Partial<ARInvoiceInput>) {
    await requireFinanceAR('edit');
    if (!id) throw new Error('Falta el ID.');
    const session = await getSession();
    const patch: any = { updated_by: session?.employeeId, updated_at: new Date().toISOString() };
    if (input.concept !== undefined) patch.concept = input.concept.trim();
    if (input.invoice_number !== undefined) patch.invoice_number = input.invoice_number?.trim() || null;
    if (input.work_date !== undefined) patch.work_date = input.work_date || null;
    if (input.invoice_date !== undefined) patch.invoice_date = input.invoice_date || null;
    if (input.due_date !== undefined) patch.due_date = input.due_date || null;
    if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
    if (input.gross_amount !== undefined) {
        const gross = Number(input.gross_amount);
        if (!isFinite(gross) || gross < 0) throw new Error('Monto (bruto) inválido.');
        const { vat, net } = computeVat(gross);
        patch.gross_amount = gross;
        patch.vat_amount = vat;
        patch.net_amount = net;
    }
    const { error } = await supabase
        .from('ar_invoices')
        .update(patch)
        .eq('id', id);
    if (error) throw new Error('Error al actualizar: ' + error.message);
    revalidatePath('/finance/receivable');
    revalidatePath(`/finance/receivable/${input.client_id ?? ''}`);
    return { ok: true };
}

export async function obsoleteARInvoiceAction(id: string) {
    const session = await requireFinanceAR('delete');
    if (!id) throw new Error('Falta el ID.');
    // No se puede obsoletar si ya tiene pagos aplicados
    const { data: inv, error: e1 } = await supabase
        .from('ar_invoices')
        .select('id, status, client_id')
        .eq('id', id)
        .single();
    if (e1 || !inv) throw new Error('No se encontró la partida.');
    if (inv.status === 'partial' || inv.status === 'paid') {
        throw new Error('No se puede obsoletar una partida con pagos aplicados. Anúlala en su lugar.');
    }
    const { error } = await supabase
        .from('ar_invoices')
        .update({ is_active: false, updated_by: session.employeeId, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw new Error('Error al obsoletar: ' + error.message);
    revalidatePath('/finance/receivable');
    revalidatePath(`/finance/receivable/${inv.client_id}`);
    return { ok: true };
}

export async function restoreARInvoiceAction(id: string) {
    const session = await requireFinanceAR('edit');
    if (!id) throw new Error('Falta el ID.');
    const { data: inv } = await supabase
        .from('ar_invoices')
        .select('client_id')
        .eq('id', id)
        .single();
    const { error } = await supabase
        .from('ar_invoices')
        .update({ is_active: true, updated_by: session.employeeId, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw new Error('Error al restaurar: ' + error.message);
    revalidatePath('/finance/receivable');
    revalidatePath(`/finance/receivable/${inv?.client_id ?? ''}`);
    return { ok: true };
}

// ============================================================================
// Pagos (ar_payments + ar_payment_allocations)
// ============================================================================

export type ARPaymentInput = {
    client_id: number;
    payment_date: string;       // YYYY-MM-DD
    amount: number;
    payment_method: 'transfer' | 'cash' | 'check' | 'card' | 'other';
    reference?: string | null;
    notes?: string | null;
    allocations: Array<{
        invoice_id: string;
        amount_applied: number;
    }>;
};

export async function registerARPaymentAction(input: ARPaymentInput) {
    const session = await requireFinanceAR('create');
    if (!input.client_id) throw new Error('Falta el cliente.');
    const amount = Number(input.amount);
    if (!isFinite(amount) || amount <= 0) throw new Error('Monto del pago inválido.');
    if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
        throw new Error('Asigna el pago a al menos una factura.');
    }
    const totalAlloc = input.allocations.reduce((s, a) => s + Number(a.amount_applied || 0), 0);
    if (Math.abs(totalAlloc - amount) > 0.01) {
        throw new Error(`La suma aplicada ($${totalAlloc.toFixed(2)}) no coincide con el monto del pago ($${amount.toFixed(2)}).`);
    }

    // 1) Insertar el pago
    const { data: pay, error: e1 } = await supabase
        .from('ar_payments')
        .insert({
            client_id: input.client_id,
            payment_date: input.payment_date,
            amount: amount,
            payment_method: input.payment_method,
            reference: input.reference?.trim() || null,
            notes: input.notes?.trim() || null,
            registered_by: session.employeeId,
        })
        .select('id')
        .single();
    if (e1 || !pay) throw new Error('Error al registrar el pago: ' + (e1?.message || ''));

    // 2) Insertar allocations (el trigger recalcula paid_amount + status)
    const { error: e2 } = await supabase
        .from('ar_payment_allocations')
        .insert(
            input.allocations.map((a) => ({
                payment_id: pay.id,
                invoice_id: a.invoice_id,
                amount_applied: Number(a.amount_applied),
            }))
        );
    if (e2) {
        // Rollback: borrar el pago
        await supabase.from('ar_payments').delete().eq('id', pay.id);
        throw new Error('Error al aplicar el pago a las facturas: ' + e2.message);
    }

    revalidatePath('/finance/receivable');
    revalidatePath(`/finance/receivable/${input.client_id}`);
    return { id: pay.id };
}

// ============================================================================
// Share links (ar_share_links) — los genera el SMAA team
// ============================================================================

export async function createShareLinkAction(
    clientId: number,
    expiresInDays: number = 30,
    label?: string | null
) {
    const session = await requireFinanceAR('create');
    if (!clientId) throw new Error('Falta el cliente.');
    const days = Math.max(1, Math.min(365, Math.floor(Number(expiresInDays) || 30)));
    const { raw, hash } = genToken();
    const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString();

    const { error } = await supabase
        .from('ar_share_links')
        .insert({
            client_id: clientId,
            token_hash: hash,
            label: label?.trim() || null,
            expires_at: expiresAt,
            status: 'active',
            created_by: session.employeeId,
        });
    if (error) throw new Error('Error al crear el link: ' + error.message);

    revalidatePath(`/finance/receivable/${clientId}`);
    return { token: raw, expires_at: expiresAt };
}

export async function revokeShareLinkAction(linkId: string) {
    const session = await requireFinanceAR('delete');
    if (!linkId) throw new Error('Falta el ID.');
    const { data: link } = await supabase
        .from('ar_share_links')
        .select('client_id')
        .eq('id', linkId)
        .single();
    const { error } = await supabase
        .from('ar_share_links')
        .update({ status: 'revoked' })
        .eq('id', linkId);
    if (error) throw new Error('Error al revocar: ' + error.message);
    if (session.role !== 'master') {
        // requireFinanceAR ya validó, no necesitamos otra cosa
    }
    revalidatePath(`/finance/receivable/${link?.client_id ?? ''}`);
    return { ok: true };
}

// ============================================================================
// Promesas — usadas internamente (la creación viene del cliente vía /api/ar/promise)
// ============================================================================

export async function markPromiseStatusAction(
    promiseId: string,
    status: 'fulfilled' | 'cancelled'
) {
    const session = await requireFinanceAR('edit');
    if (!promiseId) throw new Error('Falta el ID.');
    const { data: p } = await supabase
        .from('ar_payment_promises')
        .select('client_id')
        .eq('id', promiseId)
        .single();
    const { error } = await supabase
        .from('ar_payment_promises')
        .update({ status })
        .eq('id', promiseId);
    if (error) throw new Error('Error al actualizar la promesa: ' + error.message);
    revalidatePath(`/finance/receivable/${p?.client_id ?? ''}`);
    return { ok: true };
}

// ============================================================================
// Helpers públicos (públicos = pueden ser llamados desde rutas sin auth)
// ============================================================================

/**
 * Resuelve un share link público. Valida token + estado + expiración.
 * Devuelve { client_id, link_id } o lanza error.
 * Se llama desde /ar/[token]/page.tsx (server component) y desde /api/ar/promise.
 */
export async function resolveShareLinkAction(token: string) {
    if (!token || token.length < 16) throw new Error('Link inválido.');
    const hash = hashToken(token);
    const { data: link, error } = await supabase
        .from('ar_share_links')
        .select('id, client_id, status, expires_at')
        .eq('token_hash', hash)
        .single();
    if (error || !link) throw new Error('Link no encontrado o inválido.');
    if (link.status === 'revoked') throw new Error('Este link fue revocado.');
    if (link.status === 'expired') throw new Error('Este link expiró.');
    if (new Date(link.expires_at) < new Date()) {
        // Marcar como expirado (best-effort, no bloqueamos si falla)
        await supabase.from('ar_share_links').update({ status: 'expired' }).eq('id', link.id);
        throw new Error('Este link expiró.');
    }
    // Incrementar access_count + last_accessed_at (best-effort)
    await supabase
        .from('ar_share_links')
        .update({
            access_count: (await getAccessCount(link.id)) + 1,
            last_accessed_at: new Date().toISOString(),
        })
        .eq('id', link.id);

    return { link_id: link.id, client_id: link.client_id };
}

async function getAccessCount(linkId: string): Promise<number> {
    const { data } = await supabase
        .from('ar_share_links')
        .select('access_count')
        .eq('id', linkId)
        .single();
    return data?.access_count ?? 0;
}

/**
 * Crea una promesa desde el link público. Llamado por /api/ar/promise.
 * NO requiere permisos del SMAA team — la seguridad está en el token.
 */
export async function createPublicPromiseAction(input: {
    token: string;
    selected_invoices: Array<{ invoice_id: string; amount_committed: number }>;
    client_notes?: string | null;
    expected_payment_date?: string | null;
}) {
    if (!input.token) throw new Error('Token faltante.');
    if (!Array.isArray(input.selected_invoices) || input.selected_invoices.length === 0) {
        throw new Error('Selecciona al menos una factura para la promesa.');
    }

    // 1) Validar token + expiración
    const { link_id, client_id } = await resolveShareLinkAction(input.token);

    // 2) Calcular total
    const total = input.selected_invoices.reduce(
        (s, x) => s + Number(x.amount_committed || 0),
        0
    );
    if (total <= 0) throw new Error('El total de la promesa debe ser mayor a 0.');

    // 3) Insertar promesa
    const { data: promise, error: e1 } = await supabase
        .from('ar_payment_promises')
        .insert({
            client_id,
            share_link_id: link_id,
            promise_date: new Date().toISOString().slice(0, 10),
            expected_payment_date: input.expected_payment_date || null,
            total_committed: total,
            client_notes: input.client_notes?.trim() || null,
            status: 'pending',
        })
        .select('id')
        .single();
    if (e1 || !promise) throw new Error('Error al crear la promesa: ' + (e1?.message || ''));

    // 4) Insertar items
    const { error: e2 } = await supabase
        .from('ar_payment_promise_items')
        .insert(
            input.selected_invoices.map((x) => ({
                promise_id: promise.id,
                invoice_id: x.invoice_id,
                amount_committed: Number(x.amount_committed),
            }))
        );
    if (e2) {
        // Rollback
        await supabase.from('ar_payment_promises').delete().eq('id', promise.id);
        throw new Error('Error al guardar las facturas de la promesa: ' + e2.message);
    }

    revalidatePath(`/finance/receivable/${client_id}`);
    return { id: promise.id, total_committed: total };
}
