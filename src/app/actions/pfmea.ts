'use server';

/**
 * ===========================================================================
 * pfmea.ts — Server actions para el módulo PFMEA / AMEF.
 *
 * Riesgos: severity × occurrence × detection = RPN (1–125).
 * Solo master, document_controller, top_management o quien tenga
 * permiso 'pfmea:edit' puede crear/editar; cualquier viewer puede ver.
 * ===========================================================================
 */

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';

async function requireSession() {
    const s = await getSession();
    if (!s) throw new Error('No autenticado.');
    return s;
}

async function canManage() {
    const s = await requireSession();
    return (
        s.role === 'master' ||
        s.role === 'document_controller' ||
        s.role === 'top_management' ||
        can(s.role, s.permissions, 'pfmea', 'edit') ||
        can(s.role, s.permissions, 'pfmea', 'create')
    );
}

export type RiskInput = {
    process: string;
    failure_mode: string;
    effect: string;
    cause: string;
    severity: number;
    occurrence: number;
    detection: number;
    current_controls?: string;
    recommended_actions?: string;
    responsible?: string;
    target_date?: string | null;
    status?: 'open' | 'in_progress' | 'closed';
    notes?: string;
};

function validateRisk(r: RiskInput) {
    if (!r.process?.trim()) throw new Error('Indica el proceso / etapa.');
    if (!r.failure_mode?.trim()) throw new Error('Indica el modo de falla.');
    if (!r.effect?.trim()) throw new Error('Indica el efecto.');
    if (!r.cause?.trim()) throw new Error('Indica la causa potencial.');
    for (const k of ['severity', 'occurrence', 'detection'] as const) {
        if (!Number.isInteger(r[k]) || r[k] < 1 || r[k] > 5) {
            throw new Error(`${k} debe ser un entero entre 1 y 5.`);
        }
    }
}

export async function createPfmeaRiskAction(input: RiskInput) {
    if (!(await canManage())) throw new Error('No tienes permisos para crear riesgos.');
    validateRisk(input);
    const s = await getSession();
    const { data, error } = await supabase
        .from('pfmea_risks')
        .insert({
            ...input,
            status: input.status ?? 'open',
            created_by: s!.employeeId,
        })
        .select()
        .single();
    if (error) throw new Error('Error al crear el riesgo: ' + error.message);
    revalidatePath('/pfmea');
    return { id: data.id };
}

export async function updatePfmeaRiskAction(id: string, input: Partial<RiskInput>) {
    if (!(await canManage())) throw new Error('No tienes permisos para editar riesgos.');
    if (!id) throw new Error('Falta el ID.');
    if (input.severity !== undefined || input.occurrence !== undefined || input.detection !== undefined) {
        // Si va a actualizar alguna escala, validar
        const partial: RiskInput = {
            process: input.process ?? 'x',
            failure_mode: input.failure_mode ?? 'x',
            effect: input.effect ?? 'x',
            cause: input.cause ?? 'x',
            severity: input.severity ?? 1,
            occurrence: input.occurrence ?? 1,
            detection: input.detection ?? 1,
        };
        for (const k of ['severity', 'occurrence', 'detection'] as const) {
            if (!Number.isInteger(partial[k]) || partial[k] < 1 || partial[k] > 5) {
                throw new Error(`${k} debe ser un entero entre 1 y 5.`);
            }
        }
    }
    const { error } = await supabase.from('pfmea_risks').update(input).eq('id', id);
    if (error) throw new Error('Error al actualizar: ' + error.message);
    revalidatePath('/pfmea');
    revalidatePath(`/pfmea/${id}`);
}

export async function softDeletePfmeaRiskAction(id: string) {
    if (!(await canManage())) throw new Error('No tienes permisos para eliminar riesgos.');
    if (!id) throw new Error('Falta el ID.');
    const { error } = await supabase
        .from('pfmea_risks')
        .update({ is_active: false })
        .eq('id', id);
    if (error) throw new Error('Error al eliminar: ' + error.message);
    revalidatePath('/pfmea');
}

export async function closePfmeaRiskAction(id: string, notes?: string) {
    if (!(await canManage())) throw new Error('No tienes permisos para cerrar riesgos.');
    if (!id) throw new Error('Falta el ID.');
    const { error } = await supabase
        .from('pfmea_risks')
        .update({
            status: 'closed',
            notes: notes ? (notes + (notes.endsWith('\n') ? '' : '\n') + `[${new Date().toISOString()}] cerrado`) : undefined,
        })
        .eq('id', id);
    if (error) throw new Error('Error al cerrar: ' + error.message);
    revalidatePath('/pfmea');
    revalidatePath(`/pfmea/${id}`);
}
