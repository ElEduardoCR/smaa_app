// ===========================================================================
// Funciones puras de cálculo de nómina. Sin I/O, sin Supabase: todo entra
// por parámetro para poder probarlo (ver scripts/test-nomina-calc.ts).
// ===========================================================================

import type {
    ExemptionRule, FiscalContext, ImssRates, Periodicity, PeriodType, TaxBracket,
} from './types';

/** Redondeo a centavos, evitando el clásico 0.1 + 0.2. */
export function money(n: number): number {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Días que representa una periodicidad, para prorratear. */
export const DAYS_BY_PERIODICITY: Record<Periodicity, number> = {
    diaria: 1, semanal: 7, decenal: 10, quincenal: 15, mensual: 30, anual: 365,
};

export function periodicityFor(periodType: PeriodType | string): Periodicity {
    switch (periodType) {
        case 'monthly': return 'mensual';
        case 'biweekly': return 'quincenal';
        case 'weekly': return 'semanal';
        default: return 'mensual';
    }
}

// ---------------------------------------------------------------------------
// ISR
// ---------------------------------------------------------------------------

/**
 * Aplica una tarifa del Anexo 8: cuota fija + % sobre el excedente del
 * límite inferior del renglón en el que cae la base.
 */
export function applyTaxTable(base: number, brackets: TaxBracket[]): number {
    if (base <= 0 || brackets.length === 0) return 0;
    const sorted = [...brackets].sort((a, b) => a.lower_limit - b.lower_limit);

    let row = sorted[0];
    for (const b of sorted) {
        if (base >= b.lower_limit) row = b;
        else break;
    }
    const excedente = base - row.lower_limit;
    return money(row.fixed_fee + excedente * row.rate);
}

/**
 * ISR del periodo.
 *
 * Lo correcto es usar la tarifa de la periodicidad que corresponde. Si solo
 * hay tarifa mensual cargada, se "mensualiza" la base, se calcula y se
 * regresa a la escala del periodo — es una aproximación, y por eso el
 * llamador recibe `prorated: true` para dejar el aviso en el recibo.
 */
export function calcIsr(
    taxableBase: number,
    ctx: Pick<FiscalContext, 'isrTable' | 'isrProrated'>,
    periodDays: number,
): { isr: number; prorated: boolean } {
    if (taxableBase <= 0) return { isr: 0, prorated: ctx.isrProrated };

    if (!ctx.isrProrated) {
        return { isr: applyTaxTable(taxableBase, ctx.isrTable.brackets), prorated: false };
    }

    const tableDays = DAYS_BY_PERIODICITY[ctx.isrTable.periodicity];
    const monthlyBase = money((taxableBase * tableDays) / periodDays);
    const monthlyIsr = applyTaxTable(monthlyBase, ctx.isrTable.brackets);
    return { isr: money((monthlyIsr * periodDays) / tableDays), prorated: true };
}

/**
 * Subsidio para el empleo. Soporta los dos esquemas que ha tenido la regla
 * (tabla por rangos de ingreso, y porcentaje de la UMA) para no tener que
 * tocar el motor cuando cambie de nuevo.
 */
export function calcSubsidy(
    taxableBase: number,
    ctx: FiscalContext,
    periodDays: number,
    eligible: boolean,
): { subsidy: number; warning?: string } {
    if (!eligible || taxableBase <= 0) return { subsidy: 0 };

    switch (ctx.subsidy.scheme) {
        case 'ninguno':
            return {
                subsidy: 0,
                warning: 'subsidio_no_configurado',
            };
        case 'tabla': {
            const rows = ctx.subsidy.table.brackets;
            const sorted = [...rows].sort((a, b) => a.lower_limit - b.lower_limit);
            let match: TaxBracket | null = null;
            for (const b of sorted) {
                if (taxableBase >= b.lower_limit && (b.upper_limit === null || taxableBase <= b.upper_limit)) {
                    match = b;
                    break;
                }
            }
            return { subsidy: money(match?.subsidy_amount ?? 0) };
        }
        case 'uma_pct': {
            const monthlyBase = money((taxableBase * 30) / periodDays);
            if (ctx.subsidy.incomeCap !== null && monthlyBase > ctx.subsidy.incomeCap) {
                return { subsidy: 0 };
            }
            const monthlyUma = ctx.umaDaily * 30.4;
            const monthlySubsidy = monthlyUma * ctx.subsidy.pct;
            return { subsidy: money((monthlySubsidy * periodDays) / 30) };
        }
    }
}

// ---------------------------------------------------------------------------
// IMSS — cuotas a cargo del trabajador
// ---------------------------------------------------------------------------

export type ImssBreakdown = {
    eymExcedente: number;
    eymDinero: number;
    gmp: number;
    iv: number;
    cv: number;
    total: number;
    sbcApplied: number;
    cappedByUma: boolean;
};

/**
 * Cuotas obrero del IMSS sobre el SBC por los días cotizados.
 * Reemplaza al 3% plano que había antes, que ni topaba a 25 UMA ni
 * aplicaba la cuota de excedente sobre 3 UMA (LSS art. 106 fracc. II).
 */
export function calcImssEmployee(
    sbc: number,
    daysContributed: number,
    umaDaily: number,
    rates: ImssRates,
): ImssBreakdown {
    const tope = umaDaily * rates.sbcTopeUmas;
    const cappedByUma = sbc > tope;
    const sbcApplied = cappedByUma ? tope : sbc;
    const d = Math.max(0, daysContributed);

    const excedenteBase = Math.max(0, sbcApplied - umaDaily * rates.eymExcedenteUmas);
    const eymExcedente = money(excedenteBase * rates.eymEspecieExcedente * d);
    const eymDinero = money(sbcApplied * rates.eymDinero * d);
    const gmp = money(sbcApplied * rates.gmp * d);
    const iv = money(sbcApplied * rates.iv * d);
    const cv = money(sbcApplied * rates.cv * d);

    return {
        eymExcedente, eymDinero, gmp, iv, cv,
        total: money(eymExcedente + eymDinero + gmp + iv + cv),
        sbcApplied: money(sbcApplied),
        cappedByUma,
    };
}

// ---------------------------------------------------------------------------
// Antigüedad, vacaciones e integración del salario
// ---------------------------------------------------------------------------

export function yearsOfService(hireDate: string, asOf: string): number {
    const h = new Date(hireDate + 'T00:00:00');
    const a = new Date(asOf + 'T00:00:00');
    let years = a.getFullYear() - h.getFullYear();
    const beforeAnniversary =
        a.getMonth() < h.getMonth() ||
        (a.getMonth() === h.getMonth() && a.getDate() < h.getDate());
    if (beforeAnniversary) years--;
    return Math.max(0, years);
}

/** Días de vacaciones que le corresponden según la LFT art. 76. */
export function vacationDaysFor(
    years: number,
    rules: FiscalContext['vacationRules'],
): number {
    // El primer año de servicio (antigüedad 0 cumplida) ya genera derecho a
    // los días del renglón "1".
    const y = Math.max(1, years);
    const sorted = [...rules].sort((a, b) => a.years_from - b.years_from);
    let match = sorted[0];
    for (const r of sorted) {
        if (y >= r.years_from) match = r;
        else break;
    }
    return match?.days ?? 0;
}

/**
 * Factor de integración del SDI:
 *     1 + aguinaldo/365 + (vacaciones × prima)/365
 *
 * Se calcula, no se guarda: depende de la antigüedad, y guardarlo como
 * constante fue justo lo que dejó el 1.0453 pre-reforma congelado en la BD.
 */
export function integrationFactor(
    aguinaldoDays: number,
    vacationDays: number,
    primaVacacionalPct: number,
): number {
    return 1 + aguinaldoDays / 365 + (vacationDays * primaVacacionalPct) / 365;
}

export function integratedDailySalary(
    dailySalary: number,
    aguinaldoDays: number,
    vacationDays: number,
    primaVacacionalPct: number,
): number {
    return money(dailySalary * integrationFactor(aguinaldoDays, vacationDays, primaVacacionalPct));
}

// ---------------------------------------------------------------------------
// Gravado / exento
// ---------------------------------------------------------------------------

export type ExemptionContext = {
    umaDaily: number;
    yearsOfService: number;
    weeksInPeriod: number;
    sundaysWorked: number;
    /** Monto exento capturado a mano, para reglas de tipo 'manual'. */
    manualExempt?: number;
};

/**
 * Parte un importe en gravado y exento según la regla del concepto.
 *
 * Nota sobre horas extra: se aplica la regla general (50% exento con tope de
 * 5 UMA por semana). El trato de exención total para quien percibe el salario
 * mínimo no está implementado — si aplica, se captura como 'manual'.
 */
export function splitExemption(
    rule: ExemptionRule,
    amount: number,
    ctx: ExemptionContext,
): { taxable: number; exempt: number } {
    const amt = money(amount);
    if (amt <= 0) return { taxable: 0, exempt: 0 };

    const cap = (limit: number) => {
        const exempt = money(Math.min(amt, Math.max(0, limit)));
        return { taxable: money(amt - exempt), exempt };
    };

    switch (rule.type) {
        case 'none':
            return { taxable: amt, exempt: 0 };
        case 'all_exempt':
            return { taxable: 0, exempt: amt };
        case 'manual': {
            const exempt = money(Math.min(amt, Math.max(0, ctx.manualExempt ?? 0)));
            return { taxable: money(amt - exempt), exempt };
        }
        case 'uma_multiple':
            return cap(rule.umas * ctx.umaDaily);
        case 'uma_multiple_per_sunday':
            return cap(rule.umas * ctx.umaDaily * ctx.sundaysWorked);
        case 'uma_per_year_of_service':
            return cap(rule.umas * ctx.umaDaily * Math.max(1, ctx.yearsOfService));
        case 'overtime': {
            const half = amt * 0.5;
            const weeklyCap = 5 * ctx.umaDaily * Math.max(1, ctx.weeksInPeriod);
            return cap(Math.min(half, weeklyCap));
        }
    }
}

// ---------------------------------------------------------------------------
// Utilidades de fechas
// ---------------------------------------------------------------------------

export function daysBetweenInclusive(start: string, end: string): number {
    const s = new Date(start + 'T00:00:00').getTime();
    const e = new Date(end + 'T00:00:00').getTime();
    return Math.floor((e - s) / 86400000) + 1;
}

export function countSundays(start: string, end: string): number {
    let count = 0;
    const d = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    while (d <= e) {
        if (d.getDay() === 0) count++;
        d.setDate(d.getDate() + 1);
    }
    return count;
}
