/**
 * Pruebas de las funciones puras de cálculo de nómina.
 *
 *   npx tsx scripts/test-nomina-calc.ts
 *
 * No toca la base de datos: todos los parámetros fiscales entran a mano,
 * con valores conocidos, para poder verificar el resultado con calculadora.
 */
import {
    applyTaxTable, calcImssEmployee, calcIsr, countSundays, daysBetweenInclusive,
    integrationFactor, integratedDailySalary, money, splitExemption,
    vacationDaysFor, yearsOfService,
} from '../src/lib/nomina/calc';
import type { FiscalContext, ImssRates, TaxBracket } from '../src/lib/nomina/types';

let passed = 0;
let failed = 0;

function eq(label: string, got: number, want: number, tol = 0.005) {
    const ok = Math.abs(got - want) <= tol;
    console.log(`${ok ? '  ✓' : '  ✗'} ${label}: ${got}${ok ? '' : `  (esperado ${want})`}`);
    ok ? passed++ : failed++;
}

// Tarifa mensual ISR 2024 (la misma que siembra la migración)
const ISR_2024: TaxBracket[] = [
    [0.01, 746.04, 0, 0.0192], [746.05, 6332.05, 14.32, 0.0640],
    [6332.06, 11128.01, 371.83, 0.1088], [11128.02, 12935.82, 893.63, 0.16],
    [12935.83, 15487.71, 1182.88, 0.1792], [15487.72, 31236.49, 1640.18, 0.2136],
    [31236.50, 49233.00, 5004.12, 0.2352], [49233.01, 93993.90, 9236.89, 0.30],
    [93993.91, 125325.20, 22665.17, 0.32], [125325.21, 375975.61, 32691.18, 0.34],
    [375975.62, null, 117912.32, 0.35],
].map(([lo, hi, fee, rate]: any) => ({
    lower_limit: lo, upper_limit: hi, fixed_fee: fee, rate, subsidy_amount: null,
}));

const UMA = 108.57;   // UMA diaria 2024
const RATES: ImssRates = {
    eymEspecieExcedente: 0.004, eymExcedenteUmas: 3, eymDinero: 0.0025,
    gmp: 0.00375, iv: 0.00625, cv: 0.01125, retiro: 0, sbcTopeUmas: 25,
};
const VAC_RULES = [
    { years_from: 1, years_to: 1, days: 12 }, { years_from: 2, years_to: 2, days: 14 },
    { years_from: 3, years_to: 3, days: 16 }, { years_from: 4, years_to: 4, days: 18 },
    { years_from: 5, years_to: 5, days: 20 }, { years_from: 6, years_to: 10, days: 22 },
    { years_from: 11, years_to: 15, days: 24 }, { years_from: 16, years_to: 20, days: 26 },
];

console.log('\n── Factor de integración (SDI) ──');
// 1 + 15/365 + (12 × 0.25)/365 = 1 + 18/365
eq('factor con 15 días aguinaldo y 12 de vacaciones', integrationFactor(15, 12, 0.25), 1.049315, 1e-5);
eq('factor pre-reforma (6 días vac.) — el 1.0453 que estaba en la BD',
   integrationFactor(15, 6, 0.25), 1.045205, 1e-5);
eq('SDI de un salario diario de 600', integratedDailySalary(600, 15, 12, 0.25), 629.59);

console.log('\n── Tarifa de ISR (Anexo 8) ──');
// 15,000 cae en 12,935.83–15,487.71: 1,182.88 + (15,000 − 12,935.83) × 17.92%
eq('ISR mensual sobre base 15,000', applyTaxTable(15000, ISR_2024), 1552.78);
eq('ISR sobre base 0', applyTaxTable(0, ISR_2024), 0);
// (500 − 0.01) × 1.92%
eq('ISR en el primer renglón (base 500)', applyTaxTable(500, ISR_2024), 9.60);
// 400,000 cae en el último renglón: 117,912.32 + (400,000 − 375,975.62) × 35%
eq('ISR en el último renglón (base 400,000)', applyTaxTable(400000, ISR_2024), 126320.85);

console.log('\n── ISR prorrateado a quincena ──');
const ctxProrated = {
    isrTable: { id: 'x', kind: 'isr', periodicity: 'mensual', effective_from: '2024-01-01',
                effective_to: null, verified: true, brackets: ISR_2024 },
    isrProrated: true,
} as Pick<FiscalContext, 'isrTable' | 'isrProrated'>;
// base quincenal 7,500 → mensualizada 15,000 → ISR 1,552.78 → /2
eq('ISR de una quincena con base 7,500', calcIsr(7500, ctxProrated, 15).isr, 776.39);

console.log('\n── Cuotas obrero IMSS ──');
const imss = calcImssEmployee(600, 15, UMA, RATES);
// excedente: (600 − 3×108.57) × 0.4% × 15
eq('EyM excedente 3 UMA', imss.eymExcedente, 16.46);
eq('EyM en dinero (0.25%)', imss.eymDinero, 22.50);
eq('Gastos médicos pensionados (0.375%)', imss.gmp, 33.75);
eq('Invalidez y vida (0.625%)', imss.iv, 56.25);
eq('Cesantía y vejez (1.125%)', imss.cv, 101.25);
eq('total obrero', imss.total, 230.21);
// El 3% plano que usaba el código anterior habría dado:
console.log(`     (el 3% plano anterior habría dado ${money(600 * 0.03 * 15)} — ${money(600*0.03*15 - imss.total)} de más)`);

const topado = calcImssEmployee(5000, 15, UMA, RATES);
eq('SBC topado a 25 UMA', topado.sbcApplied, money(UMA * 25));
console.log(`  ${topado.cappedByUma ? '✓' : '✗'} marca cappedByUma`);
topado.cappedByUma ? passed++ : failed++;

console.log('\n── Gravado / exento ──');
const exCtx = { umaDaily: UMA, yearsOfService: 6, weeksInPeriod: 2, sundaysWorked: 2 };
const agui = splitExemption({ type: 'uma_multiple', umas: 30 }, 15000, exCtx);
eq('aguinaldo exento (30 UMA)', agui.exempt, 3257.10);
eq('aguinaldo gravado', agui.taxable, 11742.90);

const sep = splitExemption({ type: 'uma_per_year_of_service', umas: 90 }, 200000, exCtx);
// 90 × 108.57 × 6 años
eq('pago por separación exento (90 UMA × año)', sep.exempt, 58627.80);

const he = splitExemption({ type: 'overtime' }, 3000, exCtx);
// 50% = 1,500 vs tope 5 UMA × 2 semanas = 1,085.70 → gana el tope
eq('horas extra exentas (50%, tope 5 UMA/semana)', he.exempt, 1085.70);
eq('horas extra gravadas', he.taxable, 1914.30);

eq('regla none: todo gravado', splitExemption({ type: 'none' }, 5000, exCtx).taxable, 5000);
eq('regla all_exempt: todo exento', splitExemption({ type: 'all_exempt' }, 5000, exCtx).exempt, 5000);

console.log('\n── Antigüedad y vacaciones (LFT art. 76) ──');
eq('antigüedad 2020-03-01 → 2026-08-15', yearsOfService('2020-03-01', '2026-08-15'), 6);
eq('antigüedad justo antes del aniversario', yearsOfService('2020-09-01', '2026-08-15'), 5);
eq('vacaciones primer año (reforma 2023)', vacationDaysFor(1, VAC_RULES), 12);
eq('vacaciones al 5º año', vacationDaysFor(5, VAC_RULES), 20);
eq('vacaciones al 7º año', vacationDaysFor(7, VAC_RULES), 22);
eq('vacaciones al 18º año', vacationDaysFor(18, VAC_RULES), 26);

console.log('\n── Fechas ──');
eq('días de una quincena inclusive', daysBetweenInclusive('2026-08-01', '2026-08-15'), 15);
eq('domingos en la 1a quincena de agosto 2026', countSundays('2026-08-01', '2026-08-15'), 2);

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed === 0 ? 0 : 1);
