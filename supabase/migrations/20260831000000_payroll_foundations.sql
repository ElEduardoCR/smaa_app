-- =====================================================
-- FASE 0 — CIMIENTOS DE NÓMINA
-- =====================================================
-- Prepara el terreno para RH/Nómina sin agregar todavía módulos nuevos:
--
--   1) Repara la inconsistencia de IDs entre employees / payroll_employees
--   2) Vista canónica v_payroll_employees (une persona + datos de nómina)
--   3) Esquema fiscal vs complementario (payroll_periods.scheme)
--   4) Tipo de recibo (ordinaria | finiquito | liquidacion | aguinaldo | ptu)
--   5) Líneas de recibo con clave SAT y desglose gravado/exento
--   6) Catálogo de conceptos de nómina (payroll_concepts)
--   7) Campos fiscales del empleado que exige el CFDI de nómina 1.2
--   8) Tablas de ISR y subsidio VERSIONADAS por año y periodicidad
--   9) Parámetros fiscales versionados (UMA, cuotas IMSS, salario mínimo)
--  10) Tabla de vacaciones LFT (art. 76, reforma 2023)
--  11) Bucket PRIVADO para el expediente del empleado
--
-- Es idempotente: se puede correr varias veces sin romper nada.
-- =====================================================


-- =====================================================
-- 1) REPARACIÓN DE IDs
-- =====================================================
-- La migración 20260722220000 volvió a public.employees la fuente de verdad
-- y reapuntó las FKs, pero NO remapeó los valores que ya estaban guardados.
-- Las filas que traían un payroll_employees.id quedaron apuntando a un UUID
-- que no existe en employees → bonos, deducciones y horas del checador se
-- ignoran en silencio al calcular la nómina.
--
-- Aquí sí remapeamos los datos y después reafirmamos las FKs.

DO $$
DECLARE
    r RECORD;
    v_fixed INT;
    v_orphans INT;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('employee_bonuses'),
        ('employee_deductions'),
        ('time_clock_entries'),
        ('payroll_receipts')
    ) AS t(tbl) LOOP

        -- Solo tocamos filas cuyo employee_id NO existe en employees pero SÍ
        -- corresponde a un payroll_employees.id. Las correctas no se mueven.
        EXECUTE format($f$
            UPDATE public.%I x
               SET employee_id = pe.employee_id
              FROM public.payroll_employees pe
             WHERE x.employee_id = pe.id
               AND pe.employee_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = x.employee_id)
        $f$, r.tbl);
        GET DIAGNOSTICS v_fixed = ROW_COUNT;

        EXECUTE format($f$
            SELECT COUNT(*) FROM public.%I x
             WHERE x.employee_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = x.employee_id)
        $f$, r.tbl) INTO v_orphans;

        IF v_fixed > 0 THEN
            RAISE NOTICE '[%] % filas remapeadas a employees.id', r.tbl, v_fixed;
        END IF;
        IF v_orphans > 0 THEN
            RAISE WARNING '[%] % filas quedaron huérfanas (employee_id no existe ni en employees ni en payroll_employees). Revísalas a mano.', r.tbl, v_orphans;
        END IF;
    END LOOP;
END $$;

-- Reafirmar las FKs contra employees (por si alguna no se creó)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('employee_bonuses',   'employee_bonuses_employee_id_fkey',   'CASCADE'),
        ('employee_deductions','employee_deductions_employee_id_fkey','CASCADE'),
        ('time_clock_entries', 'time_clock_entries_employee_id_fkey', 'SET NULL'),
        ('payroll_receipts',   'payroll_receipts_employee_id_fkey',   'RESTRICT')
    ) AS t(tbl, cname, ondelete) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.conname = r.cname
              AND c.confrelid = 'public.employees'::regclass
        ) THEN
            BEGIN
                EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.cname);
                EXECUTE format(
                    'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE %s',
                    r.tbl, r.cname, r.ondelete
                );
                RAISE NOTICE '[%] FK reapuntada a employees', r.tbl;
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING '[%] no se pudo crear la FK (%). Probablemente quedan filas huérfanas.', r.tbl, SQLERRM;
            END;
        END IF;
    END LOOP;
END $$;



-- =====================================================
-- 2) ESQUEMA FISCAL vs COMPLEMENTARIO
-- =====================================================
-- "Fiscal" y "complementaria" NO son dos módulos: son la misma nómina corrida
-- dos veces sobre el mismo periodo. Modelarlo como una columna permite
-- sumar ambas para saber cuánto se le pagó realmente a cada persona, y
-- mandar al timbrado únicamente lo fiscal.

ALTER TABLE public.payroll_periods
    ADD COLUMN IF NOT EXISTS scheme TEXT NOT NULL DEFAULT 'fiscal';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_periods_scheme_chk') THEN
        ALTER TABLE public.payroll_periods
            ADD CONSTRAINT payroll_periods_scheme_chk
            CHECK (scheme IN ('fiscal', 'complementaria'));
    END IF;
END $$;

-- El índice único viejo impedía tener la corrida fiscal y la complementaria
-- del mismo periodo. Se reemplaza incluyendo scheme.
DROP INDEX IF EXISTS public.uq_payroll_period_dates;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_period_dates
    ON public.payroll_periods (start_date, end_date, period_type, scheme);

COMMENT ON COLUMN public.payroll_periods.scheme IS
    'fiscal = se timbra ante el SAT. complementaria = pago adicional no timbrado. Un mismo periodo puede tener una corrida de cada una.';


-- =====================================================
-- 3) TIPO DE RECIBO
-- =====================================================
-- Un finiquito es un recibo de nómina extraordinario, no una entidad aparte.
-- Con esta columna hereda gratis líneas, timbrado y dispersión.

ALTER TABLE public.payroll_receipts
    ADD COLUMN IF NOT EXISTS receipt_type TEXT NOT NULL DEFAULT 'ordinaria',
    -- Avisos del motor de cálculo (tabla de ISR prorrateada, falta de checador, etc.)
    ADD COLUMN IF NOT EXISTS calc_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Trazabilidad: qué versión del motor y qué parámetros se usaron
    ADD COLUMN IF NOT EXISTS calc_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS subsidy NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS taxable_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS exempt_total NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_receipts_type_chk') THEN
        ALTER TABLE public.payroll_receipts
            ADD CONSTRAINT payroll_receipts_type_chk
            CHECK (receipt_type IN ('ordinaria','finiquito','liquidacion','aguinaldo','ptu','extraordinaria'));
    END IF;
END $$;

COMMENT ON COLUMN public.payroll_receipts.subsidy IS
    'Subsidio para el empleo aplicado. Va como OtrosPagos 002 en el CFDI, no como percepción.';
COMMENT ON COLUMN public.payroll_receipts.calc_warnings IS
    'Avisos no bloqueantes del motor: ["isr_tabla_prorrateada", "sin_registros_checador", ...]. Se muestran en la UI.';


-- =====================================================
-- 4) CATÁLOGO DE CONCEPTOS DE NÓMINA
-- =====================================================
-- Hoy employee_bonuses.concept es texto libre: "Vales de despensa" no se
-- puede timbrar. Este catálogo traduce cada concepto a su clave del SAT y
-- define cómo se parte en gravado / exento.
--
-- ⚠️ Las claves SAT sembradas abajo deben ser VERIFICADAS por la contadora
--    contra el catálogo vigente (c_TipoPercepcion / c_TipoDeduccion /
--    c_TipoOtroPago) antes del primer timbrado. Por eso verified = false.

CREATE TABLE IF NOT EXISTS public.payroll_concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,              -- clave interna: 'sueldo', 'aguinaldo', 'despensa'
    name TEXT NOT NULL,                     -- como aparece en el recibo
    kind TEXT NOT NULL,                     -- 'perception' | 'deduction' | 'other_payment'
    sat_code TEXT,                          -- clave del catálogo SAT correspondiente a `kind`
    is_taxable BOOLEAN NOT NULL DEFAULT true,
    -- Regla de exención. Ejemplos:
    --   {"type":"none"}                                → todo gravado
    --   {"type":"all_exempt"}                          → todo exento
    --   {"type":"uma_multiple","umas":30}              → exento hasta 30 UMA (aguinaldo)
    --   {"type":"uma_per_year_of_service","umas":90}   → separación
    --   {"type":"overtime"}                            → 50% exento, tope 5 UMA semanales
    --   {"type":"manual"}                              → lo captura la contadora
    exemption_rule JSONB NOT NULL DEFAULT '{"type":"none"}'::jsonb,
    -- Si el concepto se paga normalmente por fuera
    default_scheme TEXT NOT NULL DEFAULT 'fiscal',
    -- ¿integra al Salario Base de Cotización del IMSS?
    integrates_sbc BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT true,
    verified BOOLEAN NOT NULL DEFAULT false,   -- la contadora confirmó la clave SAT
    verified_by UUID REFERENCES public.employees(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_concepts_kind_chk') THEN
        ALTER TABLE public.payroll_concepts
            ADD CONSTRAINT payroll_concepts_kind_chk
            CHECK (kind IN ('perception','deduction','other_payment'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_concepts_scheme_chk') THEN
        ALTER TABLE public.payroll_concepts
            ADD CONSTRAINT payroll_concepts_scheme_chk
            CHECK (default_scheme IN ('fiscal','complementaria'));
    END IF;
END $$;

ALTER TABLE public.payroll_concepts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on payroll_concepts" ON public.payroll_concepts;
CREATE POLICY "Allow all on payroll_concepts" ON public.payroll_concepts FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_concepts TO anon, authenticated, service_role;

COMMENT ON TABLE public.payroll_concepts IS
    'Catálogo de conceptos de nómina con su clave SAT y regla de exención. Prerrequisito del timbrado: sin esto los conceptos son texto libre y el CFDI no se puede armar.';

-- Semilla de conceptos comunes. TODOS entran con verified = false a propósito:
-- la contadora los valida en pantalla contra el catálogo vigente del SAT.
INSERT INTO public.payroll_concepts (code, name, kind, sat_code, is_taxable, exemption_rule, integrates_sbc, sort_order) VALUES
    -- Percepciones (c_TipoPercepcion)
    ('sueldo',            'Sueldo',                          'perception', '001', true,  '{"type":"none"}',                            true,  10),
    ('septimo_dia',       'Séptimo día',                     'perception', '001', true,  '{"type":"none"}',                            true,  11),
    ('aguinaldo',         'Aguinaldo',                       'perception', '002', true,  '{"type":"uma_multiple","umas":30}',          false, 20),
    ('ptu',               'PTU (reparto de utilidades)',     'perception', '003', true,  '{"type":"uma_multiple","umas":15}',          false, 21),
    ('fondo_ahorro',      'Fondo de ahorro',                 'perception', '005', true,  '{"type":"manual"}',                          false, 30),
    ('premio_puntualidad','Premio de puntualidad',           'perception', '010', true,  '{"type":"none"}',                            true,  31),
    ('subsidio_incap',    'Subsidio por incapacidad',        'perception', '014', false, '{"type":"all_exempt"}',                      false, 32),
    ('horas_extra',       'Horas extra',                     'perception', '019', true,  '{"type":"overtime"}',                        false, 40),
    ('prima_dominical',   'Prima dominical',                 'perception', '020', true,  '{"type":"uma_multiple_per_sunday","umas":1}',false, 41),
    ('prima_vacacional',  'Prima vacacional',                'perception', '021', true,  '{"type":"uma_multiple","umas":15}',          false, 42),
    ('prima_antiguedad',  'Prima de antigüedad',             'perception', '022', true,  '{"type":"uma_per_year_of_service","umas":90}',false,50),
    ('pago_separacion',   'Pago por separación',             'perception', '023', true,  '{"type":"uma_per_year_of_service","umas":90}',false,51),
    ('indemnizacion',     'Indemnización',                   'perception', '025', true,  '{"type":"uma_per_year_of_service","umas":90}',false,52),
    ('comisiones',        'Comisiones',                      'perception', '028', true,  '{"type":"none"}',                            true,  60),
    ('despensa',          'Vales de despensa',               'perception', '029', true,  '{"type":"manual"}',                          false, 61),
    ('otros_ingresos',    'Otros ingresos por salarios',     'perception', '038', true,  '{"type":"none"}',                            true,  70),
    -- Deducciones (c_TipoDeduccion)
    ('imss',              'IMSS (cuota obrero)',             'deduction',  '001', false, '{"type":"none"}',                            false, 10),
    ('isr',               'ISR retenido',                    'deduction',  '002', false, '{"type":"none"}',                            false, 11),
    ('prestamo_empresa',  'Préstamo de la empresa',          'deduction',  '004', false, '{"type":"none"}',                            false, 20),
    ('desc_incapacidad',  'Descuento por incapacidad',       'deduction',  '006', false, '{"type":"none"}',                            false, 21),
    ('pension_alimenticia','Pensión alimenticia',            'deduction',  '007', false, '{"type":"none"}',                            false, 22),
    ('infonavit',         'Crédito Infonavit',               'deduction',  '010', false, '{"type":"none"}',                            false, 23),
    ('infonacot',         'Crédito Infonacot',               'deduction',  '011', false, '{"type":"none"}',                            false, 24),
    ('anticipo',          'Anticipo de salarios',            'deduction',  '012', false, '{"type":"none"}',                            false, 25),
    ('ausentismo',        'Ausentismo (faltas)',             'deduction',  '020', false, '{"type":"none"}',                            false, 26),
    ('otras_deducciones', 'Otras deducciones',               'deduction',  '004', false, '{"type":"none"}',                            false, 90),
    -- Otros pagos (c_TipoOtroPago)
    ('subsidio_empleo',   'Subsidio para el empleo',         'other_payment', '002', false, '{"type":"all_exempt"}',                   false, 10),
    ('viaticos',          'Viáticos',                        'other_payment', '003', false, '{"type":"manual"}',                       false, 11)
ON CONFLICT (code) DO NOTHING;


-- =====================================================
-- 4b) BONOS Y DEDUCCIONES ENLAZADOS AL CATÁLOGO
-- =====================================================
-- Mientras el concepto sea texto libre no se puede timbrar ni saber si es
-- gravado o exento. Se enlazan al catálogo y se les da su propio scheme,
-- porque un bono "por fuera" es justamente lo que va en la complementaria.

ALTER TABLE public.employee_bonuses
    ADD COLUMN IF NOT EXISTS concept_id UUID REFERENCES public.payroll_concepts(id),
    ADD COLUMN IF NOT EXISTS scheme TEXT NOT NULL DEFAULT 'fiscal',
    ADD COLUMN IF NOT EXISTS manual_exempt NUMERIC(12,2);   -- para reglas de exención 'manual'

ALTER TABLE public.employee_deductions
    ADD COLUMN IF NOT EXISTS concept_id UUID REFERENCES public.payroll_concepts(id),
    ADD COLUMN IF NOT EXISTS scheme TEXT NOT NULL DEFAULT 'fiscal';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_bonuses_scheme_chk') THEN
        ALTER TABLE public.employee_bonuses ADD CONSTRAINT employee_bonuses_scheme_chk
            CHECK (scheme IN ('fiscal','complementaria'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_deductions_scheme_chk') THEN
        ALTER TABLE public.employee_deductions ADD CONSTRAINT employee_deductions_scheme_chk
            CHECK (scheme IN ('fiscal','complementaria'));
    END IF;
END $$;

-- Normalizador sin acentos (evita depender de la extensión unaccent).
CREATE OR REPLACE FUNCTION public.smaa_norm(t TEXT)
RETURNS TEXT AS $fn$
    SELECT lower(translate(coalesce($1, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
$fn$ LANGUAGE sql IMMUTABLE;

-- Backfill de mejor esfuerzo: enlaza por coincidencia de nombre. Lo que no
-- cuadre queda en NULL y el motor lo trata como "otros ingresos" / "otras
-- deducciones", dejando un aviso en el recibo para que se corrija a mano.
UPDATE public.employee_bonuses b
   SET concept_id = c.id
  FROM public.payroll_concepts c
 WHERE b.concept_id IS NULL
   AND c.kind = 'perception'
   AND public.smaa_norm(b.concept) = public.smaa_norm(c.name);

UPDATE public.employee_deductions d
   SET concept_id = c.id
  FROM public.payroll_concepts c
 WHERE d.concept_id IS NULL
   AND c.kind = 'deduction'
   AND public.smaa_norm(d.concept) = public.smaa_norm(c.name);


-- =====================================================
-- 5) LÍNEAS DEL RECIBO CON DESGLOSE FISCAL
-- =====================================================
-- El CFDI de nómina exige, por cada percepción, el importe gravado y el
-- exento por separado. Agregarlo ahora cuesta una migración; agregarlo
-- después obliga a recalcular todo el histórico timbrado.

ALTER TABLE public.payroll_receipt_lines
    ADD COLUMN IF NOT EXISTS concept_id UUID REFERENCES public.payroll_concepts(id),
    ADD COLUMN IF NOT EXISTS sat_code TEXT,
    ADD COLUMN IF NOT EXISTS scheme TEXT NOT NULL DEFAULT 'fiscal',
    ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS exempt_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quantity NUMERIC(10,2);   -- horas extra, días, domingos...

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_receipt_lines_scheme_chk') THEN
        ALTER TABLE public.payroll_receipt_lines
            ADD CONSTRAINT payroll_receipt_lines_scheme_chk
            CHECK (scheme IN ('fiscal','complementaria'));
    END IF;
    -- 'other_payment' se suma al neto pero no es percepción gravable
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_receipt_lines_type_chk') THEN
        ALTER TABLE public.payroll_receipt_lines
            ADD CONSTRAINT payroll_receipt_lines_type_chk
            CHECK (type IN ('perception','deduction','other_payment'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prl_receipt ON public.payroll_receipt_lines(receipt_id, sort_order);

-- Backfill: las líneas viejas asumen todo gravado o todo exento según is_taxable
UPDATE public.payroll_receipt_lines
   SET taxable_amount = CASE WHEN is_taxable AND type = 'perception' THEN amount ELSE 0 END,
       exempt_amount  = CASE WHEN NOT is_taxable AND type = 'perception' THEN amount ELSE 0 END
 WHERE taxable_amount = 0 AND exempt_amount = 0 AND amount <> 0;


-- =====================================================
-- 6) CAMPOS FISCALES DEL EMPLEADO (CFDI nómina 1.2 + CFDI 4.0)
-- =====================================================
-- Sin estos campos el timbrado se rechaza. El motivo #1 de rechazo en CFDI
-- 4.0 es que nombre / código postal / régimen del receptor no coincidan con
-- el padrón del SAT — por eso fiscal_name, fiscal_zip_code y fiscal_regime
-- se llenan desde la Constancia de Situación Fiscal del empleado
-- (ver src/lib/csfParser.ts, ya lo usamos para clientes).

ALTER TABLE public.payroll_employees
    -- Identidad fiscal (receptor del CFDI)
    ADD COLUMN IF NOT EXISTS fiscal_name TEXT,             -- nombre EXACTO como está en el SAT
    ADD COLUMN IF NOT EXISTS fiscal_zip_code TEXT,         -- DomicilioFiscalReceptor
    ADD COLUMN IF NOT EXISTS fiscal_regime TEXT DEFAULT '605',  -- 605 = Sueldos y Salarios
    ADD COLUMN IF NOT EXISTS csf_url TEXT,                 -- PDF de la constancia en el expediente
    ADD COLUMN IF NOT EXISTS csf_parsed_at TIMESTAMP WITH TIME ZONE,
    -- Complemento de nómina — Receptor
    ADD COLUMN IF NOT EXISTS clave_ent_fed TEXT,           -- c_Estado, ej. 'NLE'
    ADD COLUMN IF NOT EXISTS tipo_contrato TEXT DEFAULT '01',   -- c_TipoContrato, 01 = indeterminado
    ADD COLUMN IF NOT EXISTS tipo_jornada TEXT DEFAULT '01',    -- c_TipoJornada, 01 = diurna
    ADD COLUMN IF NOT EXISTS tipo_regimen TEXT DEFAULT '02',    -- c_TipoRegimen, 02 = sueldos y salarios
    ADD COLUMN IF NOT EXISTS riesgo_puesto TEXT,           -- c_RiesgoPuesto, clase I..V
    ADD COLUMN IF NOT EXISTS sindicalizado BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS periodicidad_pago TEXT,       -- c_PeriodicidadPago
    ADD COLUMN IF NOT EXISTS bank_sat_code TEXT,           -- c_Banco (3 dígitos)
    -- Base de cotización IMSS
    ADD COLUMN IF NOT EXISTS sbc NUMERIC(12,2),            -- Salario Base de Cotización registrado ante el IMSS
    ADD COLUMN IF NOT EXISTS aguinaldo_days INT NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS prima_vacacional_pct NUMERIC(5,4) NOT NULL DEFAULT 0.25,
    -- Registro patronal al que pertenece (por si hay más de uno)
    ADD COLUMN IF NOT EXISTS registro_patronal TEXT;

COMMENT ON COLUMN public.payroll_employees.sbc IS
    'Salario Base de Cotización dado de alta ante el IMSS. NO se recalcula solo: cambiarlo genera un movimiento de modificación de salario (IDSE).';
COMMENT ON COLUMN public.payroll_employees.daily_salary IS
    'Salario Diario Integrado (SDI). Se deriva del salario diario × factor de integración, que depende de aguinaldo_days, prima_vacacional_pct y la antigüedad (LFT art. 76). Ver lft_vacation_days.';
COMMENT ON COLUMN public.payroll_employees.fiscal_name IS
    'Nombre tal cual aparece en la Constancia de Situación Fiscal. Si no coincide con el padrón del SAT, el CFDI 4.0 se rechaza.';

-- =====================================================
-- 7) TABLAS DE ISR Y SUBSIDIO — VERSIONADAS
-- =====================================================
-- Antes vivían hardcodeadas dentro de un .tsx, lo que significaba editar
-- React cada enero. Además se calculaba el ISR mensual y se multiplicaba
-- por 0.5 para la quincena; lo correcto es usar la tabla de la periodicidad
-- que corresponde (Anexo 8 de la RMF).

CREATE TABLE IF NOT EXISTS public.tax_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,                 -- 'isr' | 'subsidio'
    periodicity TEXT NOT NULL,          -- 'diaria'|'semanal'|'decenal'|'quincenal'|'mensual'|'anual'
    effective_from DATE NOT NULL,
    effective_to DATE,                  -- NULL = vigente
    source TEXT,                        -- de dónde salió (DOF, Anexo 8, etc.)
    verified BOOLEAN NOT NULL DEFAULT false,
    verified_by UUID REFERENCES public.employees(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (kind, periodicity, effective_from)
);

CREATE TABLE IF NOT EXISTS public.tax_table_brackets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES public.tax_tables(id) ON DELETE CASCADE,
    lower_limit NUMERIC(14,2) NOT NULL,     -- límite inferior
    upper_limit NUMERIC(14,2),              -- NULL = "en adelante"
    fixed_fee NUMERIC(14,2) NOT NULL DEFAULT 0,   -- cuota fija
    rate NUMERIC(8,6) NOT NULL DEFAULT 0,          -- % sobre excedente (0.0192 = 1.92%)
    subsidy_amount NUMERIC(14,2),                  -- solo para kind = 'subsidio'
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ttb_table ON public.tax_table_brackets(table_id, lower_limit);
CREATE INDEX IF NOT EXISTS idx_tt_lookup ON public.tax_tables(kind, periodicity, effective_from, effective_to);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_tables_kind_chk') THEN
        ALTER TABLE public.tax_tables ADD CONSTRAINT tax_tables_kind_chk
            CHECK (kind IN ('isr','subsidio'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_tables_periodicity_chk') THEN
        ALTER TABLE public.tax_tables ADD CONSTRAINT tax_tables_periodicity_chk
            CHECK (periodicity IN ('diaria','semanal','decenal','quincenal','mensual','anual'));
    END IF;
END $$;

ALTER TABLE public.tax_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_table_brackets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on tax_tables" ON public.tax_tables;
DROP POLICY IF EXISTS "Allow all on tax_table_brackets" ON public.tax_table_brackets;
CREATE POLICY "Allow all on tax_tables" ON public.tax_tables FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on tax_table_brackets" ON public.tax_table_brackets FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_tables, public.tax_table_brackets TO anon, authenticated, service_role;

COMMENT ON TABLE public.tax_tables IS
    'Tarifas de ISR y subsidio por periodicidad y vigencia. El motor de nómina se NIEGA a calcular si no hay tabla vigente para el periodo: es preferible detenerse a retener de más o de menos.';

-- ---------------------------------------------------------------
-- Semilla: tarifa mensual de ISR 2024, EXPIRADA y SIN VERIFICAR.
-- Sirve como ejemplo del formato y para poder probar el motor.
-- Nunca se aplicará a un periodo de 2025 en adelante porque
-- effective_to la cierra el 2024-12-31.
-- La contadora debe cargar la tarifa vigente (ver scripts/import-tax-table.ts).
-- ---------------------------------------------------------------
DO $$
DECLARE
    v_table_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.tax_tables
        WHERE kind = 'isr' AND periodicity = 'mensual' AND effective_from = DATE '2024-01-01'
    ) THEN
        INSERT INTO public.tax_tables (kind, periodicity, effective_from, effective_to, source, verified, notes)
        VALUES ('isr','mensual', DATE '2024-01-01', DATE '2024-12-31',
                'Anexo 8 RMF 2024 — capturada automáticamente, SIN VERIFICAR',
                false,
                'Ejemplo del formato esperado. Verificar contra el DOF antes de usar y cargar la tarifa del ejercicio vigente.')
        RETURNING id INTO v_table_id;

        INSERT INTO public.tax_table_brackets (table_id, lower_limit, upper_limit, fixed_fee, rate, sort_order) VALUES
            (v_table_id,      0.01,     746.04,      0.00, 0.0192, 1),
            (v_table_id,    746.05,    6332.05,     14.32, 0.0640, 2),
            (v_table_id,   6332.06,   11128.01,    371.83, 0.1088, 3),
            (v_table_id,  11128.02,   12935.82,    893.63, 0.1600, 4),
            (v_table_id,  12935.83,   15487.71,   1182.88, 0.1792, 5),
            (v_table_id,  15487.72,   31236.49,   1640.18, 0.2136, 6),
            (v_table_id,  31236.50,   49233.00,   5004.12, 0.2352, 7),
            (v_table_id,  49233.01,   93993.90,   9236.89, 0.3000, 8),
            (v_table_id,  93993.91,  125325.20,  22665.17, 0.3200, 9),
            (v_table_id, 125325.21,  375975.61,  32691.18, 0.3400, 10),
            (v_table_id, 375975.62,       NULL, 117912.32, 0.3500, 11);
    END IF;
END $$;


-- =====================================================
-- 8) PARÁMETROS FISCALES VERSIONADOS
-- =====================================================
-- finance_settings guarda un solo valor por clave, sin vigencia. Eso hace
-- que la UMA de 2024 se siga usando en 2026 sin que nadie se entere, y que
-- el factor de integración quede congelado en un valor pre-reforma.

CREATE TABLE IF NOT EXISTS public.fiscal_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL,
    value NUMERIC(14,6),
    value_text TEXT,
    effective_from DATE NOT NULL,
    effective_to DATE,
    description TEXT,
    verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (key, effective_from),
    CHECK (value IS NOT NULL OR value_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_fp_lookup ON public.fiscal_parameters(key, effective_from, effective_to);

ALTER TABLE public.fiscal_parameters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on fiscal_parameters" ON public.fiscal_parameters;
CREATE POLICY "Allow all on fiscal_parameters" ON public.fiscal_parameters FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_parameters TO anon, authenticated, service_role;

-- Cuotas obrero del IMSS (LSS arts. 106, 107, 147, 168). Son porcentajes
-- estatutarios estables, por eso van con vigencia abierta desde 1997.
INSERT INTO public.fiscal_parameters (key, value, effective_from, description, verified) VALUES
    ('imss_eym_especie_excedente_obrero', 0.004000, DATE '1997-07-01', 'EyM prestaciones en especie: 0.40% sobre la parte del SBC que excede 3 UMA (LSS 106-II)', true),
    ('imss_eym_excedente_umas',           3.000000, DATE '1997-07-01', 'Umbral en UMA a partir del cual aplica la cuota de excedente', true),
    ('imss_eym_dinero_obrero',            0.002500, DATE '1997-07-01', 'EyM prestaciones en dinero: 0.25% del SBC (LSS 107)', true),
    ('imss_gmp_obrero',                   0.003750, DATE '1997-07-01', 'Gastos médicos pensionados: 0.375% del SBC (LSS 147)', true),
    ('imss_iv_obrero',                    0.006250, DATE '1997-07-01', 'Invalidez y vida: 0.625% del SBC (LSS 168)', true),
    ('imss_cv_obrero',                    0.011250, DATE '1997-07-01', 'Cesantía y vejez: 1.125% del SBC', true),
    ('imss_retiro_obrero',                0.000000, DATE '1997-07-01', 'Retiro: 0% a cargo del trabajador', true),
    ('sbc_tope_umas',                    25.000000, DATE '1997-07-01', 'Tope del SBC: 25 UMA', true)
ON CONFLICT (key, effective_from) DO NOTHING;

-- UMA 2024 (vigente del 1-feb-2024 al 31-ene-2025). Es el valor que ya
-- estaba en finance_settings; se migra tal cual con su vigencia real.
-- ⚠️ Falta cargar la UMA de 2025 y 2026 — el motor se detendrá hasta que existan.
INSERT INTO public.fiscal_parameters (key, value, effective_from, effective_to, description, verified) VALUES
    ('uma_daily', 108.570000, DATE '2024-02-01', DATE '2025-01-31', 'UMA diaria 2024 (migrada de finance_settings, sin verificar)', false)
ON CONFLICT (key, effective_from) DO NOTHING;

COMMENT ON TABLE public.fiscal_parameters IS
    'Parámetros fiscales con vigencia (UMA, salario mínimo, cuotas IMSS, esquema de subsidio). Reemplaza a las constantes sueltas de finance_settings. La UMA cambia cada 1 de febrero.';

-- =====================================================
-- 9) VACACIONES DE LEY (LFT art. 76, reforma 2023)
-- =====================================================
-- Se necesita aquí, antes que el módulo de vacaciones, porque el factor de
-- integración del SDI depende de los días de vacaciones que le tocan al
-- empleado según su antigüedad:
--
--     factor = 1 + (aguinaldo_days / 365) + (dias_vacaciones × prima) / 365
--
-- El valor 1.0453 que estaba en finance_settings corresponde a 6 días de
-- vacaciones (esquema anterior a la reforma de 2023). Con 12 días el factor
-- del primer año es 1.0493. Por eso se calcula y no se guarda como constante.

CREATE TABLE IF NOT EXISTS public.lft_vacation_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    years_from INT NOT NULL,          -- antigüedad cumplida, desde
    years_to INT,                     -- hasta (NULL = en adelante)
    days INT NOT NULL,
    effective_from DATE NOT NULL DEFAULT DATE '2023-01-01',
    notes TEXT,
    UNIQUE (years_from, effective_from)
);

ALTER TABLE public.lft_vacation_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on lft_vacation_days" ON public.lft_vacation_days;
CREATE POLICY "Allow all on lft_vacation_days" ON public.lft_vacation_days FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lft_vacation_days TO anon, authenticated, service_role;

INSERT INTO public.lft_vacation_days (years_from, years_to, days, effective_from, notes) VALUES
    ( 1,  1, 12, DATE '2023-01-01', 'Reforma vacaciones dignas (DOF 27-dic-2022, vigente 1-ene-2023)'),
    ( 2,  2, 14, DATE '2023-01-01', NULL),
    ( 3,  3, 16, DATE '2023-01-01', NULL),
    ( 4,  4, 18, DATE '2023-01-01', NULL),
    ( 5,  5, 20, DATE '2023-01-01', NULL),
    ( 6, 10, 22, DATE '2023-01-01', 'A partir del 6º año, +2 días por cada 5 de servicio'),
    (11, 15, 24, DATE '2023-01-01', NULL),
    (16, 20, 26, DATE '2023-01-01', NULL),
    (21, 25, 28, DATE '2023-01-01', NULL),
    (26, 30, 30, DATE '2023-01-01', NULL),
    (31, 35, 32, DATE '2023-01-01', NULL),
    (36, 40, 34, DATE '2023-01-01', NULL),
    (41, 45, 36, DATE '2023-01-01', NULL),
    (46, 50, 38, DATE '2023-01-01', NULL)
ON CONFLICT (years_from, effective_from) DO NOTHING;


-- =====================================================
-- 10) BUCKET PRIVADO DEL EXPEDIENTE
-- =====================================================
-- Todos los buckets existentes son public = true. El expediente del empleado
-- lleva INE, CURP, acta de nacimiento, comprobante de domicilio y documentos
-- de incapacidad (datos de salud): no puede vivir en un bucket público ni
-- accederse con la anon key desde el navegador.
--
-- Este bucket NO tiene policies para anon/authenticated a propósito.
-- Solo el service_role (server actions) puede leer y escribir, y la UI
-- recibe URLs firmadas de vida corta.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('employee_files', 'employee_files', false, 26214400)   -- 25 MB
ON CONFLICT (id) DO UPDATE SET public = false;

-- Por si alguien creó policies permisivas antes, las quitamos.
DROP POLICY IF EXISTS "Public read employee_files" ON storage.objects;
DROP POLICY IF EXISTS "Anon insert employee_files" ON storage.objects;
DROP POLICY IF EXISTS "Anon update employee_files" ON storage.objects;
DROP POLICY IF EXISTS "Anon delete employee_files" ON storage.objects;


-- =====================================================
-- 11) VISTA CANÓNICA DEL EMPLEADO
-- =====================================================
-- Tener dos tablas obliga a cada pantalla a hacer el join a mano — y a
-- equivocarse de id, que es justo el bug que reparamos en el punto 1.
-- Esta vista es la única forma correcta de leer "el empleado" desde el
-- motor de nómina. La clave siempre es employee_id (= employees.id).

CREATE OR REPLACE VIEW public.v_payroll_employees AS
SELECT
    e.id                    AS employee_id,
    pe.id                   AS payroll_id,
    pe.code,
    e.full_name,
    e.is_active,
    e.photo_url,
    e.phone,
    COALESCE(pe.position, e.position) AS position,
    pe.department,
    pe.status,
    -- Identidad fiscal
    pe.fiscal_name, pe.rfc, pe.curp, pe.nss,
    pe.fiscal_zip_code, pe.fiscal_regime, pe.clave_ent_fed,
    -- Relación laboral
    pe.hire_date, pe.termination_date, pe.registro_patronal,
    pe.tipo_contrato, pe.tipo_jornada, pe.tipo_regimen,
    pe.riesgo_puesto, pe.sindicalizado,
    -- Pago
    pe.payment_type, pe.periodicidad_pago,
    pe.base_salary, pe.daily_salary, pe.hourly_rate,
    pe.sbc, pe.aguinaldo_days, pe.prima_vacacional_pct,
    pe.overtime_factor, pe.weekly_hours,
    pe.bank_name, pe.bank_sat_code, pe.bank_account, pe.clabe,
    -- Fiscal / otros
    pe.isr_subsidy_eligible, pe.imss_modality,
    pe.email, pe.address, pe.birth_date, pe.notes
FROM public.employees e
JOIN public.payroll_employees pe ON pe.employee_id = e.id;

-- security_invoker hace que la vista respete las policies de quien consulta
-- (el default de Postgres es usar las del dueño). Requiere PG >= 15.
DO $$
BEGIN
    EXECUTE 'ALTER VIEW public.v_payroll_employees SET (security_invoker = true)';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'security_invoker no soportado en esta versión de Postgres; se omite.';
END $$;

GRANT SELECT ON public.v_payroll_employees TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_payroll_employees IS
    'Empleado + datos de nómina en una sola fila. La clave es employee_id (employees.id). Úsala siempre en lugar de leer payroll_employees suelta.';


-- =====================================================
-- LISTO. Pendientes que esta migración deja marcados a propósito:
--   · Cargar la tarifa de ISR vigente        → scripts/import-tax-table.ts
--   · Cargar la UMA de 2025 y 2026           → fiscal_parameters
--   · Definir el esquema de subsidio vigente → fiscal_parameters
--   · Verificar las claves SAT del catálogo  → payroll_concepts.verified
-- El motor de nómina reporta cada uno de estos con un mensaje accionable.
-- =====================================================
