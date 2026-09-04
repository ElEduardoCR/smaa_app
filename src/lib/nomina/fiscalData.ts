import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabase } from '@/lib/supabaseServer';
import { periodicityFor } from './calc';
import {
    PayrollConfigError,
    type FiscalContext, type ImssRates, type PayrollConcept,
    type Periodicity, type TaxTable,
} from './types';

// ===========================================================================
// Carga del marco fiscal vigente para un periodo.
//
// Principio: si falta un dato que cambia lo que se le retiene a la gente,
// el motor NO adivina — se detiene con un mensaje que dice exactamente qué
// cargar y dónde. Calcular con una UMA de hace dos años en silencio es peor
// que no calcular.
// ===========================================================================

/** Trae el parámetro vigente a una fecha. */
async function getParam(
    db: SupabaseClient, key: string, asOf: string,
): Promise<number | null> {
    const { data, error } = await db
        .from('fiscal_parameters')
        .select('value')
        .eq('key', key)
        .lte('effective_from', asOf)
        .or(`effective_to.is.null,effective_to.gte.${asOf}`)
        .order('effective_from', { ascending: false })
        .limit(1);
    if (error) throw error;
    const v = data?.[0]?.value;
    return v === undefined || v === null ? null : Number(v);
}

async function getParamText(
    db: SupabaseClient, key: string, asOf: string,
): Promise<string | null> {
    const { data, error } = await db
        .from('fiscal_parameters')
        .select('value_text')
        .eq('key', key)
        .lte('effective_from', asOf)
        .or(`effective_to.is.null,effective_to.gte.${asOf}`)
        .order('effective_from', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0]?.value_text ?? null;
}

async function getTaxTable(
    db: SupabaseClient, kind: 'isr' | 'subsidio', periodicity: Periodicity, asOf: string,
): Promise<TaxTable | null> {
    const { data, error } = await db
        .from('tax_tables')
        .select('id, kind, periodicity, effective_from, effective_to, verified, tax_table_brackets(lower_limit, upper_limit, fixed_fee, rate, subsidy_amount)')
        .eq('kind', kind)
        .eq('periodicity', periodicity)
        .lte('effective_from', asOf)
        .or(`effective_to.is.null,effective_to.gte.${asOf}`)
        .order('effective_from', { ascending: false })
        .limit(1);
    if (error) throw error;
    const row = data?.[0] as any;
    if (!row) return null;

    const brackets = (row.tax_table_brackets || []).map((b: any) => ({
        lower_limit: Number(b.lower_limit),
        upper_limit: b.upper_limit === null ? null : Number(b.upper_limit),
        fixed_fee: Number(b.fixed_fee),
        rate: Number(b.rate),
        subsidy_amount: b.subsidy_amount === null ? null : Number(b.subsidy_amount),
    }));
    if (brackets.length === 0) return null;

    return {
        id: row.id, kind: row.kind, periodicity: row.periodicity,
        effective_from: row.effective_from, effective_to: row.effective_to,
        verified: row.verified, brackets,
    };
}

/**
 * Arma el contexto fiscal del periodo. `asOf` normalmente es la fecha final
 * del periodo (o la de pago, si se prefiere ese criterio).
 */
export async function loadFiscalContext(
    asOf: string,
    periodType: string,
): Promise<FiscalContext> {
    const db = getServerSupabase();
    const warnings: string[] = [];
    const year = asOf.slice(0, 4);

    // --- UMA (bloqueante) --------------------------------------------------
    const umaDaily = await getParam(db, 'uma_daily', asOf);
    if (umaDaily === null || umaDaily <= 0) {
        throw new PayrollConfigError(
            `No hay UMA vigente para ${asOf}. Sin ella no se pueden calcular las cuotas del IMSS ni los topes de exención.`,
            `Captura la UMA diaria de ${year} en Configuración fiscal (tabla fiscal_parameters, clave "uma_daily"). La UMA cambia cada 1 de febrero.`,
        );
    }

    // --- Tarifa de ISR (bloqueante) ---------------------------------------
    const wanted = periodicityFor(periodType);
    let isrTable = await getTaxTable(db, 'isr', wanted, asOf);
    let isrProrated = false;

    if (!isrTable) {
        isrTable = await getTaxTable(db, 'isr', 'mensual', asOf);
        isrProrated = true;
        if (isrTable) warnings.push('isr_tabla_prorrateada');
    }
    if (!isrTable) {
        throw new PayrollConfigError(
            `No hay tarifa de ISR vigente para ${asOf} (se buscó la tarifa ${wanted} y la mensual).`,
            `Carga la tarifa del Anexo 8 vigente con: npx tsx scripts/import-tax-table.ts isr ${wanted} ${year}-01-01 <archivo.csv>`,
        );
    }
    if (!isrTable.verified) warnings.push('isr_tabla_sin_verificar');

    // --- Subsidio al empleo (no bloqueante) -------------------------------
    const scheme = (await getParamText(db, 'subsidio_scheme', asOf)) ?? 'ninguno';
    let subsidy: FiscalContext['subsidy'];
    if (scheme === 'tabla') {
        const table =
            (await getTaxTable(db, 'subsidio', wanted, asOf)) ??
            (await getTaxTable(db, 'subsidio', 'mensual', asOf));
        subsidy = table ? { scheme: 'tabla', table } : { scheme: 'ninguno' };
        if (!table) warnings.push('subsidio_tabla_faltante');
    } else if (scheme === 'uma_pct') {
        const pct = await getParam(db, 'subsidio_uma_pct', asOf);
        const cap = await getParam(db, 'subsidio_ingreso_tope', asOf);
        subsidy = pct !== null
            ? { scheme: 'uma_pct', pct, incomeCap: cap }
            : { scheme: 'ninguno' };
        if (pct === null) warnings.push('subsidio_pct_faltante');
    } else {
        subsidy = { scheme: 'ninguno' };
        warnings.push('subsidio_no_configurado');
    }

    // --- Cuotas IMSS (bloqueante si faltan) -------------------------------
    const rateKeys: Array<[keyof ImssRates, string]> = [
        ['eymEspecieExcedente', 'imss_eym_especie_excedente_obrero'],
        ['eymExcedenteUmas', 'imss_eym_excedente_umas'],
        ['eymDinero', 'imss_eym_dinero_obrero'],
        ['gmp', 'imss_gmp_obrero'],
        ['iv', 'imss_iv_obrero'],
        ['cv', 'imss_cv_obrero'],
        ['retiro', 'imss_retiro_obrero'],
        ['sbcTopeUmas', 'sbc_tope_umas'],
    ];
    const imss = {} as ImssRates;
    const missing: string[] = [];
    for (const [field, key] of rateKeys) {
        const v = await getParam(db, key, asOf);
        if (v === null) missing.push(key);
        else imss[field] = v;
    }
    if (missing.length > 0) {
        throw new PayrollConfigError(
            `Faltan parámetros de cuotas del IMSS vigentes a ${asOf}: ${missing.join(', ')}.`,
            'Estos los siembra la migración 20260831000000_payroll_foundations.sql. Verifica que se haya aplicado completa.',
        );
    }

    // --- Vacaciones LFT ----------------------------------------------------
    const { data: vac, error: vacErr } = await db
        .from('lft_vacation_days')
        .select('years_from, years_to, days')
        .lte('effective_from', asOf)
        .order('years_from');
    if (vacErr) throw vacErr;
    if (!vac || vac.length === 0) {
        throw new PayrollConfigError(
            'No hay tabla de días de vacaciones (LFT art. 76) cargada.',
            'La siembra la migración 20260831000000_payroll_foundations.sql. Verifica que se haya aplicado completa.',
        );
    }

    return {
        asOf,
        umaDaily,
        imss,
        isrTable,
        isrProrated,
        subsidy,
        vacationRules: vac.map((v: any) => ({
            years_from: Number(v.years_from),
            years_to: v.years_to === null ? null : Number(v.years_to),
            days: Number(v.days),
        })),
        warnings,
    };
}

/** Catálogo de conceptos indexado por `code`. */
export async function loadConcepts(): Promise<Map<string, PayrollConcept>> {
    const db = getServerSupabase();
    const { data, error } = await db
        .from('payroll_concepts')
        .select('*')
        .eq('active', true)
        .order('sort_order');
    if (error) throw error;

    const map = new Map<string, PayrollConcept>();
    for (const row of data || []) {
        map.set(row.code, {
            id: row.id,
            code: row.code,
            name: row.name,
            kind: row.kind,
            sat_code: row.sat_code,
            is_taxable: row.is_taxable,
            exemption_rule: row.exemption_rule ?? { type: 'none' },
            default_scheme: row.default_scheme,
            integrates_sbc: row.integrates_sbc,
            sort_order: row.sort_order,
            verified: row.verified,
        });
    }
    if (map.size === 0) {
        throw new PayrollConfigError(
            'El catálogo de conceptos de nómina está vacío.',
            'Lo siembra la migración 20260831000000_payroll_foundations.sql. Verifica que se haya aplicado completa.',
        );
    }
    return map;
}

/** Mensajes legibles para los códigos de aviso que guarda el recibo. */
export const WARNING_LABELS: Record<string, string> = {
    isr_tabla_prorrateada:
        'No hay tarifa de ISR de esta periodicidad: se usó la mensual prorrateada. El resultado es aproximado.',
    isr_tabla_sin_verificar:
        'La tarifa de ISR usada no ha sido verificada contra el DOF.',
    subsidio_no_configurado:
        'No hay esquema de subsidio al empleo configurado: se calculó sin subsidio.',
    subsidio_tabla_faltante:
        'El esquema de subsidio es por tabla, pero no hay tabla vigente cargada.',
    subsidio_pct_faltante:
        'El esquema de subsidio es por porcentaje de UMA, pero falta el porcentaje.',
    sin_registros_checador:
        'No hay registros del checador en el periodo: no se pagaron horas extra.',
    checador_incompleto:
        'El checador cubre menos días que el periodo. El salario se pagó completo (así debe ser para asalariados); si hubo faltas, captúralas como incidencia para que se descuenten.',
    sbc_estimado:
        'El empleado no tiene SBC registrado ante el IMSS: se estimó a partir del salario diario integrado.',
    sbc_topado:
        'El SBC excede el tope de 25 UMA: se aplicó el tope.',
    concepto_sin_verificar:
        'Algún concepto usa una clave SAT que la contadora aún no ha verificado.',
    sin_salario_diario:
        'El empleado no tiene salario diario capturado: se derivó del salario base entre 30.',
};
