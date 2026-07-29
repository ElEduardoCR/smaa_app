'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';

async function requireSession() {
    const s = await getSession();
    if (!s) throw new Error('No autenticado.');
    return s;
}

async function requireCan(action: 'view' | 'create' | 'edit' | 'delete') {
    const s = await requireSession();
    if (!can(s.role, s.permissions, 'purchases', action) && s.role !== 'master') {
        throw new Error(`No tienes permisos para ${action} compras.`);
    }
    return s;
}

// =============================================================================
// Crear PO (también usado para el alta manual desde el form en /purchases/new)
// =============================================================================
export type CreatePOInput = {
    supplier_id: string | null;
    subtotal: number;
    vat_total: number;
    total: number;
    supplier_quote_url?: string | null;
    notes?: string | null;
    items: Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
};

export async function createPurchaseOrderAction(input: CreatePOInput) {
    const session = await requireCan('create');
    if (!input.items || input.items.length === 0) {
        throw new Error('Agrega al menos un artículo.');
    }
    for (const it of input.items) {
        if (!it.description?.trim()) throw new Error('Cada artículo debe tener descripción.');
        if (it.quantity <= 0) throw new Error('La cantidad debe ser mayor a 0.');
        if (it.unit_price < 0) throw new Error('El precio unitario no puede ser negativo.');
    }
    if (input.supplier_id) {
        const { data: sup } = await supabase.from('suppliers').select('id').eq('id', input.supplier_id).maybeSingle();
        if (!sup) throw new Error('El proveedor seleccionado no existe.');
    }

    const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
            supplier_id: input.supplier_id,
            status: 'Draft',
            subtotal: input.subtotal,
            vat_total: input.vat_total,
            total: input.total,
            supplier_quote_url: input.supplier_quote_url?.trim() || null,
            notes: input.notes?.trim() || null,
        })
        .select('id, po_number')
        .single();
    if (poErr) throw new Error('Error al crear PO: ' + poErr.message);

    const items = input.items.map((it) => ({
        purchase_order_id: po.id,
        description: it.description.trim(),
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
    }));
    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(items);
    if (itemsErr) throw new Error('Error al crear items: ' + itemsErr.message);

    revalidatePath('/purchases');
    return { id: po.id, po_number: po.po_number };
}

// =============================================================================
// Update PO (usado por la página de edición /purchases/[id])
// =============================================================================
export type UpdatePOInput = {
    id: string;
    supplier_id: string | null;
    status: 'Draft' | 'Sent' | 'Approved' | 'Received';
    notes?: string | null;
    items: Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
};

export async function updatePurchaseOrderAction(input: UpdatePOInput) {
    const session = await requireCan('edit');
    if (!input.id) throw new Error('Falta el ID de la PO.');
    if (!input.items || input.items.length === 0) {
        throw new Error('Agrega al menos un artículo con descripción.');
    }
    if (input.supplier_id) {
        const { data: sup } = await supabase.from('suppliers').select('id').eq('id', input.supplier_id).maybeSingle();
        if (!sup) throw new Error('El proveedor seleccionado no existe.');
    }

    // Calcular totales
    const subtotal = input.items.reduce((s, it) => s + it.line_total, 0);
    const vat_total = subtotal * 0.16;
    const total = subtotal + vat_total;

    // 1. Update header
    const { error: poErr } = await supabase
        .from('purchase_orders')
        .update({
            supplier_id: input.supplier_id,
            status: input.status,
            subtotal,
            vat_total,
            total,
            notes: input.notes?.trim() || null,
        })
        .eq('id', input.id);
    if (poErr) throw new Error('Error al actualizar PO: ' + poErr.message);

    // 2. Replace items (delete + insert)
    const { error: delErr } = await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', input.id);
    if (delErr) throw new Error('Error al limpiar items: ' + delErr.message);

    const items = input.items.map((it) => ({
        purchase_order_id: input.id,
        description: it.description.trim(),
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
    }));
    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(items);
    if (itemsErr) throw new Error('Error al guardar items: ' + itemsErr.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${input.id}`);
}

// =============================================================================
// Delete PO (en realidad obsoleta — soft delete)
// =============================================================================
export async function deletePurchaseOrderAction(id: string) {
    const session = await requireCan('delete');
    if (!id) throw new Error('Falta el ID de la PO.');

    // Soft-delete: marcar como obsoleto en vez de borrar.
    // Las POs son registros contables — no deben borrarse físicamente.
    const { error } = await supabase
        .from('purchase_orders')
        .update({ is_active: false })
        .eq('id', id);
    if (error) throw new Error('Error al obsoletar: ' + error.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${id}`);
}

/** Restaura una PO que fue marcada como obsoleto. */
export async function restorePurchaseOrderAction(id: string) {
    const session = await requireCan('edit');
    if (!id) throw new Error('Falta el ID de la PO.');

    const { error } = await supabase
        .from('purchase_orders')
        .update({ is_active: true })
        .eq('id', id);
    if (error) throw new Error('Error al restaurar: ' + error.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${id}`);
}

// =============================================================================
// Recibir PO (subir factura, cambiar status a Received)
// =============================================================================
export async function receivePurchaseOrderAction(poId: string, invoiceFileBase64: string, fileName: string, contentType: string) {
    const session = await requireCan('edit');
    if (!poId) throw new Error('Falta el ID de la PO.');
    if (!invoiceFileBase64) throw new Error('La factura es obligatoria para recibir la compra.');

    // Subir el PDF/imagen de la factura a Storage
    const buf = Buffer.from(invoiceFileBase64, 'base64');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `invoices/${poId}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
        .from('purchase_files')
        .upload(path, buf, { contentType, upsert: false });
    if (upErr) throw new Error('Error al subir la factura: ' + upErr.message);

    const { data: pub } = supabase.storage.from('purchase_files').getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const { error: updateErr } = await supabase
        .from('purchase_orders')
        .update({ status: 'Received', invoice_url: publicUrl })
        .eq('id', poId);
    if (updateErr) throw new Error('Error al actualizar status: ' + updateErr.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${poId}`);
    return { invoice_url: publicUrl };
}

// =============================================================================
// Subir foto de evidencia (sin cambiar status)
// =============================================================================
export async function uploadPurchaseEvidenceAction(poId: string, photoBase64: string, fileName: string, contentType: string) {
    const session = await requireCan('edit');
    if (!poId) throw new Error('Falta el ID de la PO.');
    if (!photoBase64) throw new Error('Falta la foto.');

    const buf = Buffer.from(photoBase64, 'base64');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileExt = safeName.split('.').pop() || 'jpg';
    const path = `purchases/evidence_photos/po_${poId}_${Date.now()}.${fileExt}`;
    const { error: upErr } = await supabase.storage
        .from('purchase_files')
        .upload(path, buf, { contentType, upsert: false });
    if (upErr) throw new Error('Error al subir foto: ' + upErr.message);

    const { data: pub } = supabase.storage.from('purchase_files').getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const { error: updateErr } = await supabase
        .from('purchase_orders')
        .update({ evidence_photo_url: publicUrl })
        .eq('id', poId);
    if (updateErr) throw new Error('Error al guardar evidencia: ' + updateErr.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${poId}`);
    return { evidence_photo_url: publicUrl };
}

export async function viewPurchasesAction() {
    return await requireCan('view');
}
