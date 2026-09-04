// ===========================================================================
// Tipos del motor de nómina.
//
// Convenciones que sostienen todo el módulo:
//   · La clave del empleado SIEMPRE es employee_id (= employees.id).
//   · `scheme` distingue la corrida fiscal (se timbra) de la complementaria.
//   · Toda percepción se parte en gravado + exento desde el momento en que
//     se calcula, no al momento de timbrar.
// ===========================================================================

export type Scheme = 'fiscal' | 'complementaria';

export type PeriodType = 'monthly' | 'biweekly' | 'weekly';

export type Periodicity =
    | 'diaria' | 'semanal' | 'decenal' | 'quincenal' | 'mensual' | 'anual';

export type LineType = 'perception' | 'deduction' | 'other_payment';

export type ReceiptType =
    | 'ordinaria' | 'finiquito' | 'liquidacion' | 'aguinaldo' | 'ptu' | 'extraordinaria';

// --- Catálogo -------------------------------------------------------------

export type ExemptionRule =
    | { type: 'none' }
    | { type: 'all_exempt' }
    | { type: 'manual' }
    | { type: 'uma_multiple'; umas: number }
    | { type: 'uma_multiple_per_sunday'; umas: number }
    | { type: 'uma_per_year_of_service'; umas: number }
    | { type: 'overtime' };

export type PayrollConcept = {
    id: string;
    code: string;
    name: string;
    kind: LineType;
    sat_code: string | null;
    is_taxable: boolean;
    exemption_rule: ExemptionRule;
    default_scheme: Scheme;
    integrates_sbc: boolean;
    sort_order: number;
    verified: boolean;
};

// --- Contexto fiscal del periodo -----------------------------------------

export type TaxBracket = {
    lower_limit: number;
    upper_limit: number | null;
    fixed_fee: number;
    rate: number;
    subsidy_amount: number | null;
};

export type TaxTable = {
    id: string;
    kind: 'isr' | 'subsidio';
    periodicity: Periodicity;
    effective_from: string;
    effective_to: string | null;
    verified: boolean;
    brackets: TaxBracket[];
};

export type ImssRates = {
    eymEspecieExcedente: number;
    eymExcedenteUmas: number;
    eymDinero: number;
    gmp: number;
    iv: number;
    cv: number;
    retiro: number;
    sbcTopeUmas: number;
};

/** Todo lo que el motor necesita saber del marco fiscal para un periodo dado. */
export type FiscalContext = {
    /** Fecha con la que se resolvió la vigencia (normalmente el fin del periodo). */
    asOf: string;
    umaDaily: number;
    imss: ImssRates;
    /** Tabla de ISR de la periodicidad exacta, si existe. */
    isrTable: TaxTable;
    /** true si hubo que caer a la tabla mensual y prorratear. */
    isrProrated: boolean;
    subsidy:
        | { scheme: 'ninguno' }
        | { scheme: 'tabla'; table: TaxTable }
        | { scheme: 'uma_pct'; pct: number; incomeCap: number | null };
    vacationRules: Array<{ years_from: number; years_to: number | null; days: number }>;
    /** Avisos no bloqueantes que heredan todos los recibos del periodo. */
    warnings: string[];
};

// --- Entrada / salida del cálculo ----------------------------------------

export type EmployeeForPayroll = {
    employee_id: string;
    payroll_id: string;
    code: string | null;
    full_name: string;
    status: string | null;
    hire_date: string | null;
    termination_date: string | null;
    payment_type: string | null;
    base_salary: number;
    daily_salary: number;
    hourly_rate: number;
    sbc: number | null;
    aguinaldo_days: number;
    prima_vacacional_pct: number;
    overtime_factor: number;
    weekly_hours: number;
    isr_subsidy_eligible: boolean;
    imss_modality: string | null;
};

export type CalculatedLine = {
    concept_id: string | null;
    concept: string;
    type: LineType;
    sat_code: string | null;
    scheme: Scheme;
    amount: number;
    taxable_amount: number;
    exempt_amount: number;
    quantity: number | null;
    is_taxable: boolean;
    sort_order: number;
};

export type CalculatedReceipt = {
    employee_id: string;
    employee_name: string;
    receipt_type: ReceiptType;
    days_worked: number;
    hours_worked: number;
    overtime_hours: number;
    base_salary: number;
    overtime_pay: number;
    bonuses_total: number;
    other_income: number;
    gross_salary: number;
    taxable_total: number;
    exempt_total: number;
    isr: number;
    subsidy: number;
    imss: number;
    fixed_deductions: number;
    other_deductions: number;
    total_deductions: number;
    net_salary: number;
    lines: CalculatedLine[];
    warnings: string[];
    meta: Record<string, unknown>;
};

export type CalcResult = {
    ok: boolean;
    /** Si hay blockers no se guardó nada. */
    blockers: string[];
    warnings: string[];
    receipts: CalculatedReceipt[];
    totals: { gross: number; deductions: number; net: number };
};

/** Error con mensaje accionable para la contadora (se muestra tal cual en la UI). */
export class PayrollConfigError extends Error {
    readonly action: string;
    constructor(message: string, action: string) {
        super(message);
        this.name = 'PayrollConfigError';
        this.action = action;
    }
}
