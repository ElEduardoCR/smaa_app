# Nómina — Fase 0 (cimientos)

Estado: **el motor calcula, pero todavía no puede timbrar.** Esta fase no
agrega pantallas nuevas; arregla lo que estaba mal y deja puestas las piezas
sobre las que se construyen expediente, incidencias, finiquitos y timbrado.

## Qué cambió

| Antes | Ahora |
|---|---|
| El cálculo corría en el navegador con la anon key | Server action → `src/lib/nomina/engine.ts` |
| Tarifa de ISR hardcodeada en un `.tsx` | `tax_tables` + `tax_table_brackets`, versionadas por año y periodicidad |
| ISR mensual × 0.5 para la quincena | Tarifa de la periodicidad; si no existe, se prorratea **y se avisa** |
| IMSS = 3% plano del SBC | Cuotas obrero reales (EyM, GMP, IV, CV) con tope de 25 UMA |
| Subsidio al empleo nunca aplicado | Soporta esquema de tabla y de % de UMA |
| Factor SBC fijo en 1.0453 (pre-reforma 2023) | Se calcula: `1 + aguinaldo/365 + (vacaciones × prima)/365` |
| Conceptos en texto libre | Catálogo `payroll_concepts` con clave SAT y regla de exención |
| Percepciones sin desglose | `taxable_amount` / `exempt_amount` por línea (lo exige el CFDI) |
| Bonos y checador se ignoraban en silencio | Bug de IDs reparado (ver abajo) |

## El bug de IDs

La migración `20260722220000_unify_employees` volvió `public.employees` la
fuente de verdad y reapuntó las llaves foráneas, pero **no remapeó los valores
ya guardados**. Las filas de `employee_bonuses`, `employee_deductions`,
`time_clock_entries` y `payroll_receipts` que traían un `payroll_employees.id`
quedaron apuntando a un UUID inexistente: bonos, deducciones fijas y horas del
checador se ignoraban sin error visible.

`20260831000000_payroll_foundations` remapea los datos y reafirma las FKs.
Las filas que no correspondan a ningún empleado se reportan como `WARNING`
en la salida de la migración en vez de borrarse.

**Usa siempre la vista `v_payroll_employees`.** Une persona + datos de nómina
y su clave es `employee_id`, que es justo la confusión que causó el bug.

## Qué falta cargar para poder calcular

El motor se detiene con un mensaje accionable si falta alguno. Es a propósito:
calcular con una UMA de hace dos años en silencio es peor que no calcular.

1. **Tarifa de ISR vigente** — la migración siembra la mensual de 2024 como
   ejemplo del formato, expirada y sin verificar. Carga la real:
   ```bash
   DB_URL=postgresql://... npx tsx scripts/import-tax-table.ts isr quincenal 2026-01-01 tarifa.csv --hasta 2026-12-31 --fuente "DOF ..." --verificada
   ```
2. **UMA vigente** — cambia cada 1 de febrero. Va en `fiscal_parameters`,
   clave `uma_daily`, con su rango de vigencia.
3. **Esquema de subsidio al empleo** — `fiscal_parameters`, clave
   `subsidio_scheme`: `tabla`, `uma_pct` o `ninguno`. Mientras no se defina,
   se calcula sin subsidio y cada recibo lo dice.
4. **Verificar las claves SAT** del catálogo `payroll_concepts`. Se sembraron
   con `verified = false` a propósito: hay que cotejarlas contra
   `c_TipoPercepcion` / `c_TipoDeduccion` / `c_TipoOtroPago` antes del primer
   timbrado.

## Decisiones que conviene conocer

**Los asalariados cobran el periodo completo.** No se infieren faltas de que
no haya registro en el checador — los domingos tampoco tienen registro, y
descontarlos sería quitarles el séptimo día. Las faltas se descuentan como
incidencia capturada (concepto `ausentismo`), lo cual llega con el módulo de
incidencias. Mientras tanto, si el checador cubre menos días que el periodo,
el recibo lleva el aviso `checador_incompleto`.

**Fiscal y complementaria son la misma nómina, corrida dos veces.**
`payroll_periods.scheme` las distingue. La complementaria no retiene ISR ni
IMSS y no se timbra. Para saber cuánto se le pagó realmente a alguien, se
suman las dos corridas del mismo periodo.

**El finiquito es un recibo, no una entidad aparte.**
`payroll_receipts.receipt_type` ya acepta `finiquito` y `liquidacion`, para
que hereden líneas, timbrado y dispersión sin duplicar nada.

## Avisos que puede traer un recibo

Se guardan en `payroll_receipts.calc_warnings` y se muestran en la pantalla
del periodo. Los textos están en `WARNING_LABELS` (`src/lib/nomina/fiscalData.ts`).

## Pruebas

```bash
npx tsx scripts/test-nomina-calc.ts
```

Cubre las funciones puras: tarifa de ISR, prorrateo, cuotas del IMSS con tope,
gravado/exento (aguinaldo, separación, horas extra), factor de integración,
antigüedad y vacaciones de ley. No toca la base de datos.

## Privacidad

El expediente del empleado va al bucket **privado** `employee_files`, sin
policies para `anon`: sólo el servidor puede leerlo y la UI recibe URLs
firmadas. Los demás buckets del proyecto son públicos; ninguno debe recibir
INE, CURP, actas ni documentos de incapacidad.
