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

export type RequisitionItemInput = {
    description: string;
    quantity: number;
    unit?: string;
    notes?: string;
};

export type CreateRequisitionInput = {
    priority: 'low' | 'normal' | 'high' | 'urgent';
    needed_by: string | null;            // ISO date o null
    suggested_supplier_id: string | null;
    suggested_supplier_text: string;
    notes: string;
    items: RequisitionItemInput[];
    quotation_urls: string[];            // cotizaciones ya subidas al storage
};

export async function createRequisitionAction(input: CreateRequisitionInput) {
    const session = await requireSession();

    if (
        !can(session.role, session.permissions, 'requisitions', 'request_supplies') &&
        session.role !== 'master'
    ) {
        throw new Error('No tienes permisos para crear requisiciones.');
    }

    if (!input.items || input.items.length === 0) {
        throw new Error('Agrega al menos un artículo.');
    }
    for (const it of input.items) {
        if (!it.description?.trim() || !it.quantity || it.quantity <= 0) {
            throw new Error('Cada artículo debe tener descripción y cantidad mayor a 0.');
        }
    }

    // 1. Insertar cabecera
    const { data: code, error: codeErr } = await supabase.rpc('next_requisition_code');
    if (codeErr) throw codeErr;

    const { data: req, error: reqErr } = await supabase
        .from('requisitions')
        .insert({
            code,
            requested_by: session.employeeId,
            status: 'pending',
            priority: input.priority,
            needed_by: input.needed_by,
            suggested_supplier_id: input.suggested_supplier_id,
            suggested_supplier_text: input.suggested_supplier_text?.trim() || null,
            notes: input.notes?.trim() || null,
        })
        .select('*')
        .single();
    if (reqErr) throw reqErr;

    // 2. Insertar items
    const items = input.items.map((it) => ({
        requisition_id: req.id,
        description: it.description.trim(),
        quantity: it.quantity,
        unit: it.unit?.trim() || 'pza',
        notes: it.notes?.trim() || null,
    }));
    const { error: itemsErr } = await supabase.from('requisition_items').insert(items);
    if (itemsErr) throw itemsErr;

    // 3. Adjuntar cotizaciones
    if (input.quotation_urls?.length) {
        const qrows = input.quotation_urls.map((url) => ({
            requisition_id: req.id,
            file_url: url,
            file_name: url.split('/').pop() || 'archivo',
            uploaded_by: session.employeeId,
        }));
        const { error: qErr } = await supabase.from('requisition_quotations').insert(qrows);
        if (qErr) throw qErr;
    }

    revalidatePath('/requisitions');
    return { id: req.id, code: req.code };
}

export async function cancelRequisitionAction(id: string) {
    const session = await requireSession();
    const { data: req, error } = await supabase.from('requisitions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!req) throw new Error('Requisición no encontrada.');
    if (req.status !== 'pending') throw new Error('Solo se pueden cancelar requisiciones pendientes.');
    if (req.requested_by !== session.employeeId && session.role !== 'master' && !can(session.role, session.permissions, 'requisitions', 'purchase')) {
        throw new Error('Solo el solicitante o un comprador puede cancelar.');
    }
    const { error: upErr } = await supabase.from('requisitions').update({ status: 'cancelled' }).eq('id', id);
    if (upErr) throw upErr;
    revalidatePath('/requisitions');
    revalidatePath(`/requisitions/${id}`);
}

/** Cierra la requisición marcándola como comprada. Sube factura + foto opcional. */
export async function completePurchaseAction(
    id: string,
    invoiceUrl: string,
    invoicePhotoUrl: string | null,
    finalNotes?: string
) {
    const session = await requireSession();
    if (!can(session.role, session.permissions, 'requisitions', 'purchase') && session.role !== 'master') {
        throw new Error('No tienes permisos para cerrar compras.');
    }
    if (!invoiceUrl) throw new Error('La factura es obligatoria.');

    const { data: req, error } = await supabase.from('requisitions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!req) throw new Error('Requisición no encontrada.');
    if (req.status !== 'pending') throw new Error('La requisición ya fue procesada.');

    const { error: upErr } = await supabase
        .from('requisitions')
        .update({
            status: 'purchased',
            purchased_at: new Date().toISOString(),
            purchased_by: session.employeeId,
            invoice_url: invoiceUrl,
            invoice_photo_url: invoicePhotoUrl,
            notes: finalNotes?.trim() ? `${req.notes ? req.notes + '\n\n' : ''}[Compra] ${finalNotes.trim()}` : req.notes,
        })
        .eq('id', id);
    if (upErr) throw upErr;

    revalidatePath('/requisitions');
    revalidatePath(`/requisitions/${id}`);
}

export async function uploadRequisitionFileAction(
    base64: string,
    fileName: string,
    contentType: string
): Promise<string> {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (
        !can(session.role, session.permissions, 'requisitions', 'request_supplies') &&
        !can(session.role, session.permissions, 'requisitions', 'purchase') &&
        session.role !== 'master'
    ) {
        throw new Error('No tienes permisos para adjuntar archivos.');
    }
    const buf = Buffer.from(base64, 'base64');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `files/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from('requisition_files').upload(path, buf, {
        contentType,
        upsert: false,
    });
    if (error) throw new Error('Error al subir el archivo: ' + error.message);
    const { data } = supabase.storage.from('requisition_files').getPublicUrl(path);
    return data.publicUrl;
}
