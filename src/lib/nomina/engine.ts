import 'server-only';
import { getServerSupabase } from '@/lib/supabaseServer';
import { loadConcepts, loadFiscalContext } from './fiscalData';
import {
    calcImssEmployee, calcIsr, calcSubsidy, countSundays, daysBetweenInclusive,
    integratedDailySalary, money, splitExemption,
    vacationDaysFor, yearsOfService,
} from './calc';
import {
    PayrollConfigError,
    type CalcResult, type CalculatedLine, type CalculatedReceipt,
    type EmployeeForPayroll, type FiscalContext, type PayrollConcept, type Scheme,
} from './types';

// ===========================================================================
// Motor de nómina.
//
// Corre SIEMPRE en el servidor. Antes vivía en el navegador con la anon key,
// lo que significaba que el cálculo era manipulable desde la consola y que
// los sueldos viajaban al cliente. Aquí se recibe un period_id, se calcula
// y se persiste; el cliente solo ve el resultado.
// ===========================================================================

const PRORATE_BASE: Record<string, number> = {
    monthly: 30, biweekly: 15, weekly: 7, one_time: 0,
};

/** Prorratea un importe recurrente a los días reales del periodo. */
function prorate(amount: number, frequency: string, periodDays: number): number {
    const base = PRORATE_BASE[frequency];
    if (base === undefined) return money(amount);   // frecuencia desconocida: tal cual
    if (base === 0) return 0;                        // one_time no se aplica solo
    return money((amount * periodDays) / base);
}

type Ctx = {
    fiscal: FiscalContext;
    concepts: Map<string, PayrollConcept>;
    periodDays: number;
    periodType: string;
    scheme: Scheme;
    startDate: string;
    endDate: string;
};

type PayrollBonusRow = {
    employee_id: string | null;
    is_fixed: boolean;
    amount: number | string | null;
    frequency: string;
    concept_id: string | null;
    manual_exempt: number | string | null;
    scheme: Scheme | null;
    concept: string;
};

type PayrollDeductionRow = {
    employee_id: string | null;
    is_payroll_deduction: boolean;
    amount_per_period: number | string | null;
    remaining_amount: number | string | null;
    concept_id: string | null;
    scheme: Scheme | null;
    concept: string;
};

type PayrollTimeClockRow = {
    employee_id: string | null;
    work_date: string;
    hours_worked: number;
    approved_overtime_hours: number;
    detected_overtime_hours: number;
    attendance_incidents: string[];
};

function concept(ctx: Ctx, code: string): PayrollConcept {
    const c = ctx.concepts.get(code);
    if (!c) {
        throw new PayrollConfigError(
            `Falta el concepto "${code}" en el catálogo de nómina.`,
            'Revisa payroll_concepts: la migración 20260831000000 lo siembra.',
        );
    }
    return c;
}

function line(
    c: PayrollConcept,
    amount: number,
    opts: { taxable: number; exempt: number; scheme: Scheme; quantity?: number; nameOverride?: string },
): CalculatedLine {
    return {
        concept_id: c.id,
        concept: opts.nameOverride ?? c.name,
        type: c.kind,
        sat_code: c.sat_code,
        scheme: opts.scheme,
        amount: money(amount),
        taxable_amount: money(opts.taxable),
        exempt_amount: money(opts.exempt),
        quantity: opts.quantity ?? null,
        is_taxable: c.is_taxable,
        sort_order: c.sort_order,
    };
}

// ---------------------------------------------------------------------------
// Cálculo de un recibo
// ---------------------------------------------------------------------------

function calcReceipt(
    emp: EmployeeForPayroll,
    ctx: Ctx,
    bonuses: PayrollBonusRow[],
    deductions: PayrollDeductionRow[],
    entries: PayrollTimeClockRow[],
): CalculatedReceipt {
    const warnings: string[] = [];
    const lines: CalculatedLine[] = [];
    const { fiscal, periodDays } = ctx;

    // --- Antigüedad y salario diario --------------------------------------
    const years = emp.hire_date ? yearsOfService(emp.hire_date, ctx.endDate) : 0;
    const vacDays = vacationDaysFor(years, fiscal.vacationRules);

    let dailySalary = Number(emp.daily_salary) || 0;
    if (dailySalary <= 0) {
        dailySalary = money(Number(emp.base_salary) / 30);
        warnings.push('sin_salario_diario');
    }

    // --- Días y horas del periodo -----------------------------------------
    const hasClock = entries.length > 0;
    if (!hasClock) warnings.push('sin_registros_checador');

    const totalHours = entries.reduce((a, e) => a + Number(e.hours_worked || 0), 0);
    // Solo llegan aquí minutos extra aprobados. Los detectados pero pendientes
    // se muestran como incidencia y nunca se convierten solos en percepción.
    const overtimeHours = entries.reduce((a, e) => a + Number(e.approved_overtime_hours || 0), 0);
    const pendingOvertimeHours = entries.reduce((a, e) =>
        a + Math.max(0, Number(e.detected_overtime_hours || 0) - Number(e.approved_overtime_hours || 0)), 0);
    if (pendingOvertimeHours > 0) warnings.push('horas_extra_pendientes');
    if (entries.some(e => Array.isArray(e.attendance_incidents) && e.attendance_incidents.length > 0)) {
        warnings.push('incidencias_asistencia');
    }
    const daysWithClock = new Set(entries.map(e => e.work_date).filter(Boolean)).size;

    // --- Percepción base ---------------------------------------------------
    const paymentType = emp.payment_type || 'monthly';
    let basePay: number;
    let overtimePay = 0;
    let daysWorked: number;

    if (paymentType === 'hourly') {
        // Por hora: hours_worked ya es tiempo válido entre entrada/salida
        // explícitas menos descansos cerrados. No se descuentan extras del total.
        daysWorked = daysWithClock;
        basePay = money(totalHours * Number(emp.hourly_rate || 0));
        overtimePay = money(overtimeHours * Number(emp.hourly_rate || 0) * Number(emp.overtime_factor || 2));
    } else {
        // Asalariado: el salario cubre TODOS los días del periodo, incluidos
        // los de descanso. No se puede inferir una falta de que no haya
        // registro en el checador — los domingos tampoco lo tienen, y
        // descontarlos sería quitarle a la gente el séptimo día.
        //
        // Las faltas injustificadas se descuentan como incidencia capturada
        // (concepto 'ausentismo'), no adivinando desde el checador. Eso llega
        // con el módulo de incidencias; mientras tanto sólo se avisa.
        daysWorked = periodDays;
        basePay = money(dailySalary * periodDays);
        if (hasClock && daysWithClock < periodDays) {
            warnings.push('checador_incompleto');
        }
        if (overtimeHours > 0) {
            const hourlyEquiv = dailySalary / 8;
            overtimePay = money(overtimeHours * hourlyEquiv * Number(emp.overtime_factor || 2));
        }
    }

    const exemptionCtx = {
        umaDaily: fiscal.umaDaily,
        yearsOfService: years,
        weeksInPeriod: periodDays / 7,
        sundaysWorked: countSundays(ctx.startDate, ctx.endDate),
    };

    const sueldo = concept(ctx, 'sueldo');
    lines.push(line(sueldo, basePay, {
        taxable: basePay, exempt: 0, scheme: ctx.scheme, quantity: daysWorked,
    }));

    if (overtimePay > 0) {
        const c = concept(ctx, 'horas_extra');
        const split = splitExemption(c.exemption_rule, overtimePay, exemptionCtx);
        lines.push(line(c, overtimePay, { ...split, scheme: ctx.scheme, quantity: overtimeHours }));
    }

    // --- Bonos / percepciones fijas ---------------------------------------
    let bonusesTotal = 0;
    for (const b of bonuses) {
        if (!b.is_fixed) continue;
        const amount = prorate(Number(b.amount || 0), b.frequency, periodDays);
        if (amount <= 0) continue;

        const c = b.concept_id
            ? [...ctx.concepts.values()].find((x) => x.id === b.concept_id)
            : undefined;
        const resolved = c ?? concept(ctx, 'otros_ingresos');
        if (!c) warnings.push('concepto_sin_catalogar');
        if (!resolved.verified) warnings.push('concepto_sin_verificar');

        const split = splitExemption(
            resolved.exemption_rule, amount,
            { ...exemptionCtx, manualExempt: Number(b.manual_exempt || 0) },
        );
        bonusesTotal += amount;
        lines.push(line(resolved, amount, {
            ...split, scheme: (b.scheme as Scheme) || resolved.default_scheme,
            nameOverride: b.concept,
        }));
    }

    // --- Totales de percepciones ------------------------------------------
    const perceptions = lines.filter((l) => l.type === 'perception');
    const grossSalary = money(perceptions.reduce((a, l) => a + l.amount, 0));
    const taxableTotal = money(perceptions.reduce((a, l) => a + l.taxable_amount, 0));
    const exemptTotal = money(perceptions.reduce((a, l) => a + l.exempt_amount, 0));

    // --- ISR y subsidio ----------------------------------------------------
    // La corrida complementaria no se timbra y, por definición, no retiene.
    let isr = 0;
    let subsidy = 0;
    if (ctx.scheme === 'fiscal') {
        const r = calcIsr(taxableTotal, fiscal, periodDays);
        isr = r.isr;

        const s = calcSubsidy(taxableTotal, fiscal, periodDays, emp.isr_subsidy_eligible !== false);
        subsidy = s.subsidy;
        if (s.warning) warnings.push(s.warning);

        // El subsidio primero acredita contra el ISR; el remanente se entrega.
        const applied = Math.min(subsidy, isr);
        isr = money(isr - applied);
        const delivered = money(subsidy - applied);

        if (isr > 0) {
            const c = concept(ctx, 'isr');
            lines.push(line(c, isr, { taxable: 0, exempt: 0, scheme: 'fiscal' }));
        }
        if (delivered > 0) {
            const c = concept(ctx, 'subsidio_empleo');
            lines.push(line(c, delivered, { taxable: 0, exempt: delivered, scheme: 'fiscal' }));
        }
        subsidy = money(subsidy);
    }

    // --- IMSS --------------------------------------------------------------
    let imssTotal = 0;
    if (ctx.scheme === 'fiscal' && emp.imss_modality !== 'out') {
        let sbc = Number(emp.sbc) || 0;
        if (sbc <= 0) {
            sbc = integratedDailySalary(
                dailySalary, emp.aguinaldo_days ?? 15, vacDays, emp.prima_vacacional_pct ?? 0.25,
            );
            warnings.push('sbc_estimado');
        }
        const imss = calcImssEmployee(sbc, daysWorked, fiscal.umaDaily, fiscal.imss);
        if (imss.cappedByUma) warnings.push('sbc_topado');
        imssTotal = imss.total;
        if (imssTotal > 0) {
            const c = concept(ctx, 'imss');
            lines.push(line(c, imssTotal, { taxable: 0, exempt: 0, scheme: 'fiscal' }));
        }
    }

    // --- Deducciones fijas -------------------------------------------------
    let fixedDeductions = 0;
    for (const d of deductions) {
        if (d.is_payroll_deduction === false) continue;
        const amount = money(Number(d.amount_per_period || 0));
        if (amount <= 0) continue;
        // No descontar más que el saldo pendiente (préstamos ya liquidados)
        const remaining = d.remaining_amount === null || d.remaining_amount === undefined
            ? null : Number(d.remaining_amount);
        const toDeduct = remaining !== null ? money(Math.min(amount, Math.max(0, remaining))) : amount;
        if (toDeduct <= 0) continue;

        const c = d.concept_id
            ? [...ctx.concepts.values()].find((x) => x.id === d.concept_id)
            : undefined;
        const resolved = c ?? concept(ctx, 'otras_deducciones');
        if (!c) warnings.push('concepto_sin_catalogar');

        fixedDeductions += toDeduct;
        lines.push(line(resolved, toDeduct, {
            taxable: 0, exempt: 0,
            scheme: (d.scheme as Scheme) || resolved.default_scheme,
            nameOverride: d.concept,
        }));
    }

    // --- Neto --------------------------------------------------------------
    const otherPayments = money(
        lines.filter((l) => l.type === 'other_payment').reduce((a, l) => a + l.amount, 0),
    );
    const totalDeductions = money(isr + imssTotal + fixedDeductions);
    const netSalary = money(grossSalary + otherPayments - totalDeductions);

    return {
        employee_id: emp.employee_id,
        employee_name: emp.full_name,
        receipt_type: 'ordinaria',
        days_worked: daysWorked,
        hours_worked: money(totalHours),
        overtime_hours: money(overtimeHours),
        base_salary: basePay,
        overtime_pay: overtimePay,
        bonuses_total: money(bonusesTotal),
        other_income: otherPayments,
        gross_salary: grossSalary,
        taxable_total: taxableTotal,
        exempt_total: exemptTotal,
        isr,
        subsidy,
        imss: imssTotal,
        fixed_deductions: money(fixedDeductions),
        other_deductions: 0,
        total_deductions: totalDeductions,
        net_salary: netSalary,
        lines: lines.sort((a, b) => a.sort_order - b.sort_order),
        warnings: [...new Set(warnings)],
        meta: {
            engine_version: 1,
            years_of_service: years,
            vacation_days: vacDays,
            daily_salary: dailySalary,
            uma_daily: fiscal.umaDaily,
            isr_table_id: fiscal.isrTable.id,
            isr_prorated: fiscal.isrProrated,
            scheme: ctx.scheme,
            pending_overtime_hours: money(pendingOvertimeHours),
        },
    };
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

/** Calcula la nómina de un periodo. No persiste nada. */
export async function calculatePeriod(periodId: string): Promise<CalcResult> {
    const db = getServerSupabase();

    const { data: period, error: pErr } = await db
        .from('payroll_periods').select('*').eq('id', periodId).single();
    if (pErr) throw pErr;
    if (!period) throw new Error('El periodo no existe.');

    const scheme: Scheme = (period.scheme as Scheme) || 'fiscal';
    const startDate: string = period.start_date;
    const endDate: string = period.end_date;
    const periodDays = daysBetweenInclusive(startDate, endDate);
    const asOf: string = period.payment_date || endDate;

    const fiscal = await loadFiscalContext(asOf, period.period_type);
    const concepts = await loadConcepts();

    const ctx: Ctx = {
        fiscal, concepts, periodDays, periodType: period.period_type,
        scheme, startDate, endDate,
    };

    // Empleados activos (vista canónica: la clave es employee_id)
    const { data: emps, error: eErr } = await db
        .from('v_payroll_employees')
        .select('*')
        .eq('status', 'active')
        .order('full_name');
    if (eErr) throw eErr;
    if (!emps || emps.length === 0) {
        return {
            ok: false,
            blockers: ['No hay empleados activos con datos de nómina capturados.'],
            warnings: [], receipts: [], totals: { gross: 0, deductions: 0, net: 0 },
        };
    }
    const employeeIds = emps.map((employee) => employee.employee_id);

    // Bonos, deducciones y checador — indexados por employee_id. Por ahora
    // nomina consume exclusivamente la capa canonica de archivos semanales;
    // attendance_events se conserva, pero su automatizacion esta desactivada.
    const [bonusesResult, deductionsResult, timeClockResult] = await Promise.all([
        db.from('employee_bonuses').select('*').eq('active', true).in('employee_id', employeeIds),
        db.from('employee_deductions').select('*').eq('active', true).in('employee_id', employeeIds),
        db.from('time_clock_daily_records')
            .select('id, employee_id, work_date, worked_minutes')
            .in('employee_id', employeeIds)
            .gte('work_date', startDate).lte('work_date', endDate),
    ]);
    if (bonusesResult.error) throw bonusesResult.error;
    if (deductionsResult.error) throw deductionsResult.error;
    if (timeClockResult.error) throw timeClockResult.error;

    const bs = bonusesResult.data || [];
    const ds = deductionsResult.data || [];
    const entries = (timeClockResult.data || []).map(entry => ({
        ...entry,
        hours_worked: Number(entry.worked_minutes || 0) / 60,
        approved_overtime_hours: 0,
        detected_overtime_hours: 0,
        attendance_incidents: [],
        source: 'file_import',
    }));

    const byEmployee = <T extends { employee_id: string | null }>(rows: T[] | null) => {
        const m = new Map<string, T[]>();
        for (const r of rows || []) {
            if (!r.employee_id) continue;
            const arr = m.get(r.employee_id) || [];
            arr.push(r);
            m.set(r.employee_id, arr);
        }
        return m;
    };
    const bonusMap = byEmployee(bs as PayrollBonusRow[]);
    const dedMap = byEmployee(ds as PayrollDeductionRow[]);
    const entryMap = byEmployee(entries);

    const receipts: CalculatedReceipt[] = [];
    for (const raw of emps) {
        const emp: EmployeeForPayroll = {
            employee_id: raw.employee_id,
            payroll_id: raw.payroll_id,
            code: raw.code,
            full_name: raw.full_name,
            status: raw.status,
            hire_date: raw.hire_date,
            termination_date: raw.termination_date,
            payment_type: raw.payment_type,
            base_salary: Number(raw.base_salary || 0),
            daily_salary: Number(raw.daily_salary || 0),
            hourly_rate: Number(raw.hourly_rate || 0),
            sbc: raw.sbc === null ? null : Number(raw.sbc),
            aguinaldo_days: Number(raw.aguinaldo_days ?? 15),
            prima_vacacional_pct: Number(raw.prima_vacacional_pct ?? 0.25),
            overtime_factor: Number(raw.overtime_factor ?? 2),
            weekly_hours: Number(raw.weekly_hours ?? 48),
            isr_subsidy_eligible: raw.isr_subsidy_eligible !== false,
            imss_modality: raw.imss_modality,
        };

        // Empleado dado de baja antes de que empiece el periodo: se omite.
        if (emp.termination_date && emp.termination_date < startDate) continue;

        receipts.push(calcReceipt(
            emp, ctx,
            bonusMap.get(emp.employee_id) || [],
            dedMap.get(emp.employee_id) || [],
            entryMap.get(emp.employee_id) || [],
        ));
    }

    return {
        ok: true,
        blockers: [],
        warnings: fiscal.warnings,
        receipts,
        totals: {
            gross: money(receipts.reduce((a, r) => a + r.gross_salary, 0)),
            deductions: money(receipts.reduce((a, r) => a + r.total_deductions, 0)),
            net: money(receipts.reduce((a, r) => a + r.net_salary, 0)),
        },
    };
}

/**
 * Calcula y guarda. Reemplaza los recibos previos del periodo.
 *
 * Sin transacciones vía PostgREST, así que se hace en el menor número de
 * viajes posible: borrar, insertar recibos en bloque, insertar líneas en
 * bloque. Con 40 empleados es una operación de milisegundos.
 */
export async function calculateAndSavePeriod(periodId: string): Promise<CalcResult> {
    const db = getServerSupabase();
    const result = await calculatePeriod(periodId);
    if (!result.ok) return result;

    const { data: period } = await db
        .from('payroll_periods').select('status').eq('id', periodId).single();
    if (period?.status === 'paid') {
        return {
            ...result, ok: false,
            blockers: ['El periodo ya está marcado como pagado: no se puede recalcular. Crea una corrida complementaria si hay ajustes.'],
        };
    }

    await db.from('payroll_receipts').delete().eq('period_id', periodId);

    const rows = result.receipts.map((r) => ({
        period_id: periodId,
        employee_id: r.employee_id,
        receipt_type: r.receipt_type,
        days_worked: r.days_worked,
        hours_worked: r.hours_worked,
        overtime_hours: r.overtime_hours,
        base_salary: r.base_salary,
        overtime_pay: r.overtime_pay,
        bonuses_total: r.bonuses_total,
        other_income: r.other_income,
        gross_salary: r.gross_salary,
        taxable_total: r.taxable_total,
        exempt_total: r.exempt_total,
        isr: r.isr,
        subsidy: r.subsidy,
        imss: r.imss,
        fixed_deductions: r.fixed_deductions,
        other_deductions: r.other_deductions,
        total_deductions: r.total_deductions,
        net_salary: r.net_salary,
        calc_warnings: r.warnings,
        calc_meta: r.meta,
    }));

    const { data: inserted, error: iErr } = await db
        .from('payroll_receipts').insert(rows).select('id, employee_id');
    if (iErr) throw iErr;

    const idByEmployee = new Map<string, string>(
        (inserted || []).map((receipt) => [receipt.employee_id, receipt.id]),
    );
    const lineRows = result.receipts.flatMap((r) => {
        const receiptId = idByEmployee.get(r.employee_id);
        if (!receiptId) return [];
        return r.lines.map((l, i) => ({
            receipt_id: receiptId,
            concept_id: l.concept_id,
            concept: l.concept,
            type: l.type,
            sat_code: l.sat_code,
            scheme: l.scheme,
            amount: l.amount,
            taxable_amount: l.taxable_amount,
            exempt_amount: l.exempt_amount,
            quantity: l.quantity,
            is_taxable: l.is_taxable,
            sort_order: i,
        }));
    });
    if (lineRows.length > 0) {
        const { error: lErr } = await db.from('payroll_receipt_lines').insert(lineRows);
        if (lErr) throw lErr;
    }

    await db.from('payroll_periods').update({
        status: 'calculated',
        total_gross: result.totals.gross,
        total_deductions: result.totals.deductions,
        total_net: result.totals.net,
        updated_at: new Date().toISOString(),
    }).eq('id', periodId);

    return result;
}
