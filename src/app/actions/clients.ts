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
    if (!can(s.role, s.permissions, 'clients', action) && s.role !== 'master') {
        throw new Error(`No tienes permisos para ${action} clientes.`);
    }
    return s;
}

export type CreateClientInput = {
    rfc: string;
    business_name: string;
    fiscal_regime: string;
    fiscal_zip_code: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    payment_days?: number;
    requires_advance?: boolean;
    advance_pct?: number | null;
    constancia_pdf_url?: string | null;
};

export async function createClientAction(input: CreateClientInput) {
    const session = await requireCan('create');

    // Validaciones de negocio
    if (!input.rfc || input.rfc.length < 12 || input.rfc.length > 13) {
        throw new Error('RFC inválido (debe tener 12 o 13 caracteres).');
    }
    if (!input.business_name || input.business_name.trim().length < 3) {
        throw new Error('La razón social debe tener al menos 3 caracteres.');
    }

    const rfc = input.rfc.trim().toUpperCase();
    const { data, error } = await supabase
        .from('clients')
        .insert({
            rfc,
            business_name: input.business_name.trim(),
            fiscal_regime: input.fiscal_regime?.trim() || null,
            fiscal_zip_code: input.fiscal_zip_code?.trim() || null,
            email: input.email?.trim() || null,
            phone: input.phone?.trim() || null,
            address: input.address?.trim() || null,
            payment_days: input.payment_days ?? 0,
            requires_advance: input.requires_advance ?? false,
            advance_pct: input.requires_advance
                ? Math.min(100, Math.max(0, Number(input.advance_pct) || 0))
                : null,
            constancia_pdf_url: input.constancia_pdf_url?.trim() || null,
        })
        .select('*')
        .single();
    if (error) {
        if ((error as any).code === '23505') {
            throw new Error(`Ya existe un cliente con el RFC ${rfc}.`);
        }
        throw new Error('Error al crear cliente: ' + error.message);
    }

    revalidatePath('/clients');
    return { id: data.id, rfc: data.rfc };
}

export type UpdateClientInput = Partial<CreateClientInput> & { id: string };

export async function updateClientAction(input: UpdateClientInput) {
    const session = await requireCan('edit');
    if (!input.id) throw new Error('Falta el ID del cliente.');

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
    if (input.payment_days !== undefined) patch.payment_days = input.payment_days;
    if (input.requires_advance !== undefined) {
        patch.requires_advance = input.requires_advance;
        if (!input.requires_advance) {
            patch.advance_pct = null;
        }
    }
    if (input.advance_pct !== undefined && input.requires_advance) {
        patch.advance_pct = Math.min(100, Math.max(0, Number(input.advance_pct) || 0));
    }
    if (input.constancia_pdf_url !== undefined) patch.constancia_pdf_url = input.constancia_pdf_url?.trim() || null;

    const { error } = await supabase
        .from('clients')
        .update(patch)
        .eq('id', input.id);
    if (error) {
        if ((error as any).code === '23505') {
            throw new Error(`Ya existe otro cliente con ese RFC.`);
        }
        throw new Error('Error al actualizar: ' + error.message);
    }

    revalidatePath('/clients');
    revalidatePath(`/clients/${input.id}`);
}

export async function deleteClientAction(id: string) {
    const session = await requireCan('delete');
    if (!id) throw new Error('Falta el ID del cliente.');

    // Soft-delete: marcar como obsoleto en vez de borrar.
    // Mantiene el audit trail (ventas, cotizaciones, etc).
    const { error } = await supabase
        .from('clients')
        .update({ is_active: false })
        .eq('id', id);
    if (error) throw new Error('Error al obsoletar: ' + error.message);

    revalidatePath('/clients');
}

/** Restaura un cliente que fue marcado como obsoleto. */
export async function restoreClientAction(id: string) {
    const session = await requireCan('edit');
    if (!id) throw new Error('Falta el ID del cliente.');

    const { error } = await supabase
        .from('clients')
        .update({ is_active: true })
        .eq('id', id);
    if (error) throw new Error('Error al restaurar: ' + error.message);

    revalidatePath('/clients');
}

export async function viewClientsAction() {
    return await requireCan('view');
}
