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
    purchase_group_id?: string | null;
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
            purchase_group_id: input.purchase_group_id ?? null,
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
// MULTICOMPRA: crear N POs en una sola transacción, una por proveedor,
// todas compartiendo un mismo `purchase_group_id`.
//
// Cada grupo debe tener al menos 1 item con descripción y cantidad > 0.
// Si una sola falla, hacemos rollback conceptual borrando las POs creadas.
// =============================================================================
export type MultiPurchaseGroupInput = {
    supplier_id: string | null;
    items: Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
    supplier_quote_url?: string | null;
};

export type CreateMultiPOInput = {
    notes?: string | null;
    groups: MultiPurchaseGroupInput[];
};

export async function createMultiPurchaseOrderAction(input: CreateMultiPOInput) {
    const session = await requireCan('create');

    if (!input.groups || input.groups.length < 2) {
        throw new Error('La multicompra requiere al menos 2 proveedores.');
    }

    // Validación por grupo
    for (let g = 0; g < input.groups.length; g++) {
        const group = input.groups[g];
        if (!group.supplier_id) throw new Error(`Grupo ${g + 1}: selecciona un proveedor.`);
        if (!group.items || group.items.length === 0) {
            throw new Error(`Grupo ${g + 1}: agrega al menos un artículo.`);
        }
        for (const it of group.items) {
            if (!it.description?.trim()) throw new Error(`Grupo ${g + 1}: cada artículo debe tener descripción.`);
            if (it.quantity <= 0) throw new Error(`Grupo ${g + 1}: la cantidad debe ser mayor a 0.`);
            if (it.unit_price < 0) throw new Error(`Grupo ${g + 1}: el precio unitario no puede ser negativo.`);
        }
        // Validar proveedor
        const { data: sup } = await supabase.from('suppliers').select('id').eq('id', group.supplier_id).maybeSingle();
        if (!sup) throw new Error(`Grupo ${g + 1}: el proveedor seleccionado no existe.`);
    }

    // Un único UUID para el grupo (Postgres lo genera en la primera PO y lo
    // propagamos a las siguientes). En la primera usamos gen_random_uuid()
    // explícitamente para tener un valor conocido desde el cliente.
    const groupId = (await import('crypto')).randomUUID();

    const createdPOs: { id: string; po_number: string; supplier_id: string; subtotal: number; vat_total: number; total: number }[] = [];

    try {
        for (const group of input.groups) {
            const subtotal = group.items.reduce((s, it) => s + it.line_total, 0);
            const vat_total = subtotal * 0.16;
            const total = subtotal + vat_total;

            const { data: po, error: poErr } = await supabase
                .from('purchase_orders')
                .insert({
                    supplier_id: group.supplier_id,
                    status: 'Draft',
                    subtotal,
                    vat_total,
                    total,
                    supplier_quote_url: group.supplier_quote_url?.trim() || null,
                    notes: input.notes?.trim() || null,
                    purchase_group_id: groupId,
                })
                .select('id, po_number')
                .single();

            if (poErr) throw new Error(`Error creando PO del grupo: ${poErr.message}`);

            const items = group.items.map((it) => ({
                purchase_order_id: po.id,
                description: it.description.trim(),
                quantity: it.quantity,
                unit_price: it.unit_price,
                line_total: it.line_total,
            }));
            const { error: itemsErr } = await supabase.from('purchase_order_items').insert(items);
            if (itemsErr) throw new Error('Error creando items: ' + itemsErr.message);

            createdPOs.push({
                id: po.id,
                po_number: po.po_number,
                supplier_id: group.supplier_id!,
                subtotal,
                vat_total,
                total,
            });
        }
    } catch (err) {
        // Rollback: borrar las POs que sí se crearon. Si esto también
        // falla, las POs huérfanas quedan — admin las limpia con el
        // botón "Obsoletar" (que ya existe en la lista).
        for (const p of createdPOs) {
            await supabase.from('purchase_orders').delete().eq('id', p.id);
        }
        throw err;
    }

    revalidatePath('/purchases');

    return {
        purchase_group_id: groupId,
        pos: createdPOs,
    };
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
// Recibir PO (subir 1..N archivos de factura, cambiar status a Received)
//
// Acepta un array de archivos. Antes solo aceptaba uno. Ahora una
// compra puede traer varias facturas (por ejemplo: una principal +
// una nota de crédito + un complemento de pago).
// =============================================================================
export type ReceiveFile = {
    base64: string;
    fileName: string;
    contentType: string;
};

export async function receivePurchaseOrderAction(
    poId: string,
    files: ReceiveFile[],
    evidenceFiles: ReceiveFile[] = []
) {
    const session = await requireCan('edit');
    if (!poId) throw new Error('Falta el ID de la PO.');
    if (!files || files.length === 0) {
        throw new Error('Sube al menos una factura (PDF o imagen) para recibir la compra.');
    }

    // Subir todas las facturas y registrar en purchase_order_attachments
    const uploaded: { url: string; fileName: string; contentType: string }[] = [];
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (!f.base64) throw new Error(`Archivo ${i + 1}: falta el contenido.`);
        const buf = Buffer.from(f.base64, 'base64');
        const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `invoices/${poId}/${Date.now()}-${i}-${safeName}`;
        const { error: upErr } = await supabase.storage
            .from('purchase_files')
            .upload(path, buf, { contentType: f.contentType, upsert: false });
        if (upErr) throw new Error('Error al subir factura: ' + upErr.message);
        const { data: pub } = supabase.storage.from('purchase_files').getPublicUrl(path);
        uploaded.push({ url: pub.publicUrl, fileName: f.fileName, contentType: f.contentType });
    }

    // Insertar todas las filas de adjuntos (invoices)
    const attachmentRows = uploaded.map((u) => ({
        purchase_order_id: poId,
        kind: 'invoice',
        file_url: u.url,
        file_name: u.fileName,
        content_type: u.contentType,
        uploaded_by: session.employeeId,
    }));
    const { error: attErr } = await supabase
        .from('purchase_order_attachments')
        .insert(attachmentRows);
    if (attErr) throw new Error('Error al registrar facturas: ' + attErr.message);

    // Evidencia fotográfica (opcional). No cambia status por sí sola.
    const evidenceRows: any[] = [];
    for (let i = 0; i < evidenceFiles.length; i++) {
        const f = evidenceFiles[i];
        if (!f.base64) continue;
        const buf = Buffer.from(f.base64, 'base64');
        const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const fileExt = safeName.split('.').pop() || 'jpg';
        const path = `purchases/evidence_photos/po_${poId}_${Date.now()}_${i}.${fileExt}`;
        const { error: upErr } = await supabase.storage
            .from('purchase_files')
            .upload(path, buf, { contentType: f.contentType, upsert: false });
        if (upErr) throw new Error('Error al subir evidencia: ' + upErr.message);
        const { data: pub } = supabase.storage.from('purchase_files').getPublicUrl(path);
        evidenceRows.push({
            purchase_order_id: poId,
            kind: 'evidence',
            file_url: pub.publicUrl,
            file_name: f.fileName,
            content_type: f.contentType,
            uploaded_by: session.employeeId,
        });
    }
    if (evidenceRows.length > 0) {
        const { error: eErr } = await supabase
            .from('purchase_order_attachments')
            .insert(evidenceRows);
        if (eErr) throw new Error('Error al registrar evidencia: ' + eErr.message);
    }

    // Actualizar la PO: status = Received, y mantener invoice_url con
    // la primera factura (retrocompatibilidad con el resto del sistema).
    const firstInvoice = uploaded[0]?.url || null;
    const firstEvidence = evidenceRows[0]?.file_url || null;
    const { error: updateErr } = await supabase
        .from('purchase_orders')
        .update({
            status: 'Received',
            invoice_url: firstInvoice,
            evidence_photo_url: firstEvidence,
        })
        .eq('id', poId);
    if (updateErr) throw new Error('Error al actualizar status: ' + updateErr.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${poId}`);
    return {
        invoice_url: firstInvoice,
        attachment_count: uploaded.length,
        evidence_count: evidenceRows.length,
    };
}

// =============================================================================
// Subir foto de evidencia ADICIONAL sin cambiar status
// (compatibilidad con el botón "Subir Foto" del listado)
//
// Antes solo aceptaba un archivo. Ahora se usa internamente por
// `addPurchaseAttachmentAction` (que es multi-archivo y es la
// API recomendada). Esta función se conserva para no romper
// usos existentes en otros lugares.
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

    // Guardar también en la nueva tabla de adjuntos
    await supabase.from('purchase_order_attachments').insert({
        purchase_order_id: poId,
        kind: 'evidence',
        file_url: publicUrl,
        file_name: fileName,
        content_type: contentType,
        uploaded_by: session.employeeId,
    });

    const { error: updateErr } = await supabase
        .from('purchase_orders')
        .update({ evidence_photo_url: publicUrl })
        .eq('id', poId);
    if (updateErr) throw new Error('Error al guardar evidencia: ' + updateErr.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${poId}`);
    return { evidence_photo_url: publicUrl };
}

// =============================================================================
// Agregar N adjuntos a una PO ya existente (sin cambiar status).
// Útil para "agregar otra factura" o "subir más evidencia" sin
// reabrir el flujo de "Recibir".
// =============================================================================
export async function addPurchaseAttachmentAction(
    poId: string,
    files: ReceiveFile[],
    kind: 'invoice' | 'evidence' | 'other' = 'other'
) {
    const session = await requireCan('edit');
    if (!poId) throw new Error('Falta el ID de la PO.');
    if (!files || files.length === 0) throw new Error('Selecciona al menos un archivo.');

    const rows: any[] = [];
    for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (!f.base64) continue;
        const buf = Buffer.from(f.base64, 'base64');
        const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${kind}/${poId}/${Date.now()}-${i}-${safeName}`;
        const { error: upErr } = await supabase.storage
            .from('purchase_files')
            .upload(path, buf, { contentType: f.contentType, upsert: false });
        if (upErr) throw new Error(`Error al subir ${f.fileName}: ${upErr.message}`);
        const { data: pub } = supabase.storage.from('purchase_files').getPublicUrl(path);
        rows.push({
            purchase_order_id: poId,
            kind,
            file_url: pub.publicUrl,
            file_name: f.fileName,
            content_type: f.contentType,
            uploaded_by: session.employeeId,
        });
    }
    if (rows.length === 0) throw new Error('No se pudo subir ninguno de los archivos.');

    const { error: insErr } = await supabase
        .from('purchase_order_attachments')
        .insert(rows);
    if (insErr) throw new Error('Error al registrar adjuntos: ' + insErr.message);

    // Si era la primera factura y la PO no tenía invoice_url, la llenamos
    if (kind === 'invoice') {
        const { data: po } = await supabase
            .from('purchase_orders')
            .select('invoice_url')
            .eq('id', poId)
            .maybeSingle();
        if (po && !po.invoice_url) {
            await supabase
                .from('purchase_orders')
                .update({ invoice_url: rows[0].file_url })
                .eq('id', poId);
        }
    }

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${poId}`);
    return { count: rows.length, files: rows.map((r) => ({ url: r.file_url, name: r.file_name })) };
}

// =============================================================================
// Eliminar un adjunto (storage + BD)
// =============================================================================
export async function deletePurchaseAttachmentAction(attachmentId: string) {
    const session = await requireCan('edit');
    if (!attachmentId) throw new Error('Falta el ID del adjunto.');

    const { data: att } = await supabase
        .from('purchase_order_attachments')
        .select('*')
        .eq('id', attachmentId)
        .maybeSingle();
    if (!att) throw new Error('Adjunto no encontrado.');

    // Borrar del storage
    try {
        const path = (att as any).file_url.split('/purchase_files/').pop();
        if (path) {
            await supabase.storage.from('purchase_files').remove([path]);
        }
    } catch (storageErr) {
        console.warn('[deletePurchaseAttachmentAction] storage delete warning:', storageErr);
    }

    const { error } = await supabase
        .from('purchase_order_attachments')
        .delete()
        .eq('id', attachmentId);
    if (error) throw new Error('Error al eliminar: ' + error.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${(att as any).purchase_order_id}`);
    return { ok: true };
}

export async function viewPurchasesAction() {
    return await requireCan('view');
}
