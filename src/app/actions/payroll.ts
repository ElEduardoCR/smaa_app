'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { calculateAndSavePeriod, calculatePeriod } from '@/lib/nomina/engine';
import { WARNING_LABELS } from '@/lib/nomina/fiscalData';
import { PayrollConfigError, type CalcResult } from '@/lib/nomina/types';

// ===========================================================================
// Server actions de nómina.
//
// Todo el cálculo vive detrás de estas funciones. El navegador ya no lee
// sueldos ni escribe recibos: manda un period_id y recibe el resultado.
// ===========================================================================

/**
 * getServerSupabase() lanza un mensaje genérico si falta la clave. Aquí se
 * traduce a algo accionable, porque quien va a leerlo es la contadora.
 */
function assertServerConfigured() {
    if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new PayrollConfigError(
            'El servidor no tiene configurada la clave secreta de Supabase, y sin ella no se puede calcular nómina.',
            'Agrega SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.local y en las variables de entorno de Vercel. Está en Supabase → Project Settings → API.',
        );
    }
}

async function requirePayrollWrite() {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (session.role === 'master') return session;
    if (!can(session.role, session.permissions, 'finance', 'edit')) {
        throw new Error('No tienes permisos para calcular nómina.');
    }
    return session;
}

async function requirePayrollView() {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (session.role === 'master') return session;
    if (!can(session.role, session.permissions, 'finance', 'view')) {
        throw new Error('No tienes permisos para ver la nómina.');
    }
    return session;
}

/** Respuesta serializable para el cliente. */
export type PayrollActionResult =
    | { ok: true; result: CalcResult; warningLabels: Record<string, string> }
    | { ok: false; error: string; action?: string };

function toActionError(e: unknown): PayrollActionResult {
    if (e instanceof PayrollConfigError) {
        return { ok: false, error: e.message, action: e.action };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Error al calcular la nómina.' };
}

/** Calcula sin guardar: sirve para previsualizar antes de reemplazar recibos. */
export async function previewPayrollAction(periodId: string): Promise<PayrollActionResult> {
    await requirePayrollView();
    try {
        assertServerConfigured();
        const result = await calculatePeriod(periodId);
        return { ok: true, result, warningLabels: WARNING_LABELS };
    } catch (e) {
        return toActionError(e);
    }
}

/** Calcula y reemplaza los recibos del periodo. */
export async function calculatePayrollAction(periodId: string): Promise<PayrollActionResult> {
    await requirePayrollWrite();
    try {
        assertServerConfigured();
        const result = await calculateAndSavePeriod(periodId);
        revalidatePath(`/finance/payroll/${periodId}`);
        revalidatePath('/finance/payroll');
        return { ok: true, result, warningLabels: WARNING_LABELS };
    } catch (e) {
        return toActionError(e);
    }
}
