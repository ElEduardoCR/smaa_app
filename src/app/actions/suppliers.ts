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
    if (!can(s.role, s.permissions, 'suppliers', action) && s.role !== 'master') {
        throw new Error(`No tienes permisos para ${action} proveedores.`);
    }
    return s;
}

export type CreateSupplierInput = {
    rfc: string;
    business_name: string;
    fiscal_regime?: string | null;
    fiscal_zip_code?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    constancia_pdf_url?: string | null;
};

export async function createSupplierAction(input: CreateSupplierInput) {
    const session = await requireCan('create');

    if (!input.rfc || input.rfc.length < 12 || input.rfc.length > 13) {
        throw new Error('RFC inválido (debe tener 12 o 13 caracteres).');
    }
    if (!input.business_name || input.business_name.trim().length < 3) {
        throw new Error('La razón social debe tener al menos 3 caracteres.');
    }

    const rfc = input.rfc.trim().toUpperCase();
    const { data, error } = await supabase
        .from('suppliers')
        .insert({
            rfc,
            business_name: input.business_name.trim(),
            fiscal_regime: input.fiscal_regime?.trim() || null,
            fiscal_zip_code: input.fiscal_zip_code?.trim() || null,
            email: input.email?.trim() || null,
            phone: input.phone?.trim() || null,
            address: input.address?.trim() || null,
            constancia_pdf_url: input.constancia_pdf_url?.trim() || null,
        })
        .select('*')
        .single();
    if (error) {
        if ((error as any).code === '23505') {
            throw new Error(`Ya existe un proveedor con el RFC ${rfc}.`);
        }
        throw new Error('Error al crear proveedor: ' + error.message);
    }

    revalidatePath('/suppliers');
    return { id: data.id, rfc: data.rfc };
}

export type UpdateSupplierInput = Partial<CreateSupplierInput> & { id: string };

export async function updateSupplierAction(input: UpdateSupplierInput) {
    const session = await requireCan('edit');
    if (!input.id) throw new Error('Falta el ID del proveedor.');

    const patch: Record<string, any> = {};
    if (input.rfc !== undefined) {
        if (input.rfc.length < 12 || input.rfc.length > 13) {
            throw new Error('RFC inválido.');
        }
        patch.rfc = input.rfc.trim().toUpperCase();
    }
    if (input.business_name !== undefined) {
        if (input.business_name.trim().length < 3) {
            throw new Error('Razón social demasiado corta.');
        }
        patch.business_name = input.business_name.trim();
    }
    if (input.fiscal_regime !== undefined) patch.fiscal_regime = input.fiscal_regime?.trim() || null;
    if (input.fiscal_zip_code !== undefined) patch.fiscal_zip_code = input.fiscal_zip_code?.trim() || null;
    if (input.email !== undefined) patch.email = input.email?.trim() || null;
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
    if (input.address !== undefined) patch.address = input.address?.trim() || null;
    if (input.constancia_pdf_url !== undefined) patch.constancia_pdf_url = input.constancia_pdf_url?.trim() || null;

    const { error } = await supabase
        .from('suppliers')
        .update(patch)
        .eq('id', input.id);
    if (error) {
        if ((error as any).code === '23505') {
            throw new Error(`Ya existe otro proveedor con ese RFC.`);
        }
        throw new Error('Error al actualizar: ' + error.message);
    }

    revalidatePath('/suppliers');
}

export async function deleteSupplierAction(id: string) {
    const session = await requireCan('delete');
    if (!id) throw new Error('Falta el ID del proveedor.');

    // Verificar que no haya POs referenciando este supplier
    const { count } = await supabase
        .from('purchase_orders')
        .select('id', { count: 'exact', head: true })
        .eq('supplier_id', id);
    if (count && count > 0) {
        throw new Error(`No se puede eliminar: hay ${count} orden(es) de compra que referencian este proveedor.`);
    }

    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw new Error('Error al eliminar: ' + error.message);

    revalidatePath('/suppliers');
}

export async function viewSuppliersAction() {
    return await requireCan('view');
}
