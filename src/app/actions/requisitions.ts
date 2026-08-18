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

export type RequisitionUploadPurpose =
    | 'quotation'
    | 'purchase_invoice'
    | 'purchase_evidence';

const REQUISITION_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

type RequisitionRecord = {
    suggested_supplier_id: string | null;
    suggested_supplier_text: string | null;
};

type RequisitionItemRecord = {
    description: string;
    quantity: number;
};

function hasRequisitionUploadPermission(
    session: Awaited<ReturnType<typeof requireSession>>,
    purpose: RequisitionUploadPurpose
) {
    if (session.role === 'master') return true;
    if (purpose === 'quotation') {
        return can(session.role, session.permissions, 'requisitions', 'create') ||
            can(session.role, session.permissions, 'requisitions', 'request_supplies');
    }
    return can(session.role, session.permissions, 'requisitions', 'purchase');
}

function validateRequisitionUpload(
    fileName: string,
    contentType: string,
    fileSize: number,
    purpose: RequisitionUploadPurpose
) {
    if (!fileName?.trim()) throw new Error('El archivo no tiene nombre.');
    if (!Number.isFinite(fileSize) || fileSize <= 0) throw new Error('El archivo está vacío.');
    if (fileSize > REQUISITION_FILE_LIMIT_BYTES) {
        throw new Error('El archivo excede el límite de 20 MB.');
    }

    const safeType = (contentType || '').toLowerCase();
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const isImage = safeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(extension);
    const isPdf = safeType === 'application/pdf' || extension === 'pdf';
    const isOfficeDocument = [
        'doc', 'docx', 'xls', 'xlsx',
    ].includes(extension);

    if (purpose === 'purchase_evidence' && !isImage) {
        throw new Error('La evidencia de recibido debe ser una imagen.');
    }
    if (purpose === 'purchase_invoice' && !isPdf && !isImage) {
        throw new Error('La factura debe ser un PDF o una imagen.');
    }
    if (purpose === 'quotation' && !isPdf && !isImage && !isOfficeDocument) {
        throw new Error('La cotización debe ser PDF, imagen, Word o Excel.');
    }
}

export async function createRequisitionAction(input: CreateRequisitionInput) {
    const session = await requireSession();

    // Aceptamos `can_create` o `can_request_supplies` (sinónimos en este módulo).
    const canCreate = session.role === 'master' ||
        can(session.role, session.permissions, 'requisitions', 'create') ||
        can(session.role, session.permissions, 'requisitions', 'request_supplies');

    if (!canCreate) {
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
    if (error) {
        console.error('[completePurchaseAction] no se pudo leer la requisición', id, error);
        throw new Error('No se pudo leer la requisición: ' + (error.message || 'error desconocido.'));
    }
    if (!req) throw new Error('Requisición no encontrada.');
    if (req.status !== 'pending') throw new Error('La requisición ya fue procesada.');

    // Traer los items de la requisición para copiarlos al PO
    const { data: reqItems } = await supabase
        .from('requisition_items')
        .select('description, quantity, unit, notes')
        .eq('requisition_id', id);

    // Traer la primera cotización adjunta (si hay) para usarla como
    // supplier_quote_url del PO
    const { data: firstQuotation } = await supabase
        .from('requisition_quotations')
        .select('file_url')
        .eq('requisition_id', id)
        .order('uploaded_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    // Resolver el supplier_id: si la requisición lo tiene, usarlo. Si solo
    // tiene texto libre, intentar matchear por business_name. Si no, null
    // (el comprador lo asigna después con purchases:edit).
    const typedReq = req as typeof req & RequisitionRecord;
    let supplierId: string | null = typedReq.suggested_supplier_id || null;
    if (!supplierId && typedReq.suggested_supplier_text) {
        try {
            const { data: matched } = await supabase
                .from('suppliers')
                .select('id')
                .ilike('business_name', typedReq.suggested_supplier_text.trim())
                .limit(1)
                .maybeSingle();
            if (matched) supplierId = matched.id;
        } catch (matchErr) {
            // No bloqueamos el cierre de compra si falla el match — solo dejamos
            // supplier_id en null y el comprador lo asigna después.
            console.warn('[completePurchaseAction] supplier match falló (no crítico):', matchErr);
        }
    }

    // Construir notas combinadas
    const combinedNotes = [
        req.notes,
        finalNotes?.trim() ? `[Compra] ${finalNotes.trim()}` : null,
    ].filter(Boolean).join('\n\n') || null;

    // 1. Auto-crear la PO en Draft (linkeada a la requisición). El comprador
    // con `purchases:edit` completará después precios, supplier (si quedó null),
    // y cambiará a Sent/Approved/Received.
    const { data: insertedPO, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
            supplier_id: supplierId,
            status: 'Draft',
            subtotal: 0,
            vat_total: 0,
            total: 0,
            supplier_quote_url: firstQuotation?.file_url || null,
            invoice_url: invoiceUrl,
            evidence_photo_url: invoicePhotoUrl,
            invoice_date: new Date().toISOString(),
            requisition_id: id,
            notes: combinedNotes,
        })
        .select('id, po_number')
        .single();
    if (poErr) {
        console.error('[completePurchaseAction] no se pudo crear la PO', poErr);
        throw new Error('No se pudo crear la orden de compra: ' + (poErr.message || 'error desconocido.'));
    }

    // 2. Copiar los items de la requisición al PO (con precios 0; el
    // comprador los llena después).
    if (reqItems && reqItems.length > 0) {
        const poItems = (reqItems as RequisitionItemRecord[]).map((it) => ({
            purchase_order_id: insertedPO.id,
            description: it.description,
            quantity: it.quantity,
            unit_price: 0,
            line_total: 0,
        }));
        const { error: itemsErr } = await supabase
            .from('purchase_order_items')
            .insert(poItems);
        if (itemsErr) {
            console.error('[completePurchaseAction] no se pudieron copiar los items', itemsErr);
            throw new Error('No se pudieron copiar los artículos a la PO: ' + (itemsErr.message || 'error desconocido.'));
        }
    }

    // 3. Marcar la requisición como comprada
    const { error: upErr } = await supabase
        .from('requisitions')
        .update({
            status: 'purchased',
            purchased_at: new Date().toISOString(),
            purchased_by: session.employeeId,
            invoice_url: invoiceUrl,
            invoice_photo_url: invoicePhotoUrl,
            notes: combinedNotes,
        })
        .eq('id', id);
    if (upErr) {
        console.error('[completePurchaseAction] no se pudo marcar la requisición como comprada', upErr);
        throw new Error('No se pudo actualizar la requisición: ' + (upErr.message || 'error desconocido.'));
    }

    // revalidate va al FINAL, solo si todo lo anterior tuvo éxito. Si lo
    // pusiéramos antes, un fallo posterior dejaría al Server Component
    // con caché vieja apuntando a un estado roto.
    try {
        revalidatePath('/requisitions');
        revalidatePath(`/requisitions/${id}`);
        revalidatePath('/purchases');
    } catch (rvErr) {
        // revalidate no es crítico: la próxima navegación refrescará igual.
        console.warn('[completePurchaseAction] revalidatePath warning:', rvErr);
    }

    return {
        poId: insertedPO.id,
        poNumber: insertedPO.po_number,
        needsSupplier: !supplierId,
    };
}

export async function createRequisitionUploadAction(
    fileName: string,
    contentType: string,
    fileSize: number,
    purpose: RequisitionUploadPurpose
): Promise<{ path: string; token: string; publicUrl: string }> {
    const session = await requireSession();
    if (!hasRequisitionUploadPermission(session, purpose)) {
        throw new Error(
            purpose === 'quotation'
                ? 'No tienes permisos para adjuntar cotizaciones.'
                : 'No tienes permisos para adjuntar evidencia de compra.'
        );
    }
    validateRequisitionUpload(fileName, contentType, fileSize, purpose);

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const folder = purpose === 'quotation'
        ? 'quotations'
        : purpose === 'purchase_invoice'
            ? 'purchase_invoices'
            : 'purchase_evidence';
    const path = `${folder}/${Date.now()}-${session.employeeId}-${safeName}`;
    const { data, error } = await supabase.storage
        .from('requisition_files')
        .createSignedUploadUrl(path, {
            upsert: false,
        });
    if (error || !data?.token) {
        throw new Error('No se pudo preparar la carga: ' + (error?.message || 'token no generado.'));
    }
    const { data: publicData } = supabase.storage.from('requisition_files').getPublicUrl(path);
    return { path, token: data.token, publicUrl: publicData.publicUrl };
}
