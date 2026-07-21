-- =====================================================
-- FINANCE / PAYROLL / ACCOUNTING MODULE
-- Empleados, checador, nómina, declaraciones mensuales
-- (IVA, ISR provisional, almacén de declaraciones)
-- =====================================================

-- -----------------------------------------------------
-- 1) Empleados / personal contratado
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,                     -- 'EMP-001' (también sirve para relacionar con checador)
    full_name TEXT NOT NULL,
    rfc TEXT,
    curp TEXT,
    nss TEXT,                                       -- Número de Seguridad Social
    email TEXT,
    phone TEXT,
    address TEXT,
    birth_date DATE,
    hire_date DATE NOT NULL,
    termination_date DATE,
    status TEXT NOT NULL DEFAULT 'active',         -- 'active' | 'inactive' | 'suspended' | 'terminated'
    position TEXT,                                 -- puesto
    department TEXT,                               -- área / departamento
    -- Configuración de pago
    payment_type TEXT NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'biweekly' | 'weekly' | 'hourly' | 'daily'
    base_salary NUMERIC(12,2) NOT NULL DEFAULT 0, -- salario base mensual (o salario diario si payment_type='daily', o rate por hora si 'hourly')
    daily_salary NUMERIC(12,2) DEFAULT 0,          -- salario diario integrado (para cálculo de vacaciones/finiquito)
    hourly_rate NUMERIC(12,2) DEFAULT 0,           -- rate por hora (sólo si payment_type='hourly')
    overtime_factor NUMERIC(4,2) DEFAULT 2.0,       -- factor horas extras (2 = dobles, 3 = triples). Default México: 2x/3x
    weekly_hours INT DEFAULT 48,                   -- jornada semanal pactada
    bank_name TEXT,
    bank_account TEXT,
    clabe TEXT,
    photo_url TEXT,
    notes TEXT,
    -- Configuración fiscal
    isr_subsidy_eligible BOOLEAN DEFAULT true,     -- aplica subsidio al empleo
    imss_modality TEXT DEFAULT 'ordinario',         -- 'ordinario' | 'domestico' | 'out'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON public.employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_code ON public.employees(code);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on employees" ON public.employees;
CREATE POLICY "Allow all on employees" ON public.employees FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 2) Bonos / percepciones fijas por empleado
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_bonuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    concept TEXT NOT NULL,                -- 'Bono de productividad', 'Vales de despensa', 'Comisión', etc.
    amount NUMERIC(12,2) NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'biweekly' | 'weekly' | 'one_time'
    is_taxable BOOLEAN NOT NULL DEFAULT true,    -- ¿se suma para ISR?
    is_fixed BOOLEAN NOT NULL DEFAULT true,      -- ¿se paga automáticamente cada periodo?
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.employee_bonuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on employee_bonuses" ON public.employee_bonuses;
CREATE POLICY "Allow all on employee_bonuses" ON public.employee_bonuses FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3) Deducciones fijas por empleado (préstamos, anticipos, etc.)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_deductions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    concept TEXT NOT NULL,                -- 'Préstamo', 'Anticipo', 'Pensión alimenticia', 'Seguro'
    amount_per_period NUMERIC(12,2) NOT NULL,
    total_amount NUMERIC(12,2),           -- si es un préstamo, el total adeudado
    remaining_amount NUMERIC(12,2),       -- saldo pendiente (se actualiza al pagar)
    is_payroll_deduction BOOLEAN NOT NULL DEFAULT true, -- se descuenta en cada nómina
    active BOOLEAN NOT NULL DEFAULT true,
    started_at DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.employee_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on employee_deductions" ON public.employee_deductions;
CREATE POLICY "Allow all on employee_deductions" ON public.employee_deductions FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 4) Cargas del checador (archivos subidos)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_clock_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    format TEXT,                          -- 'csv' | 'xlsx' | 'txt'
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'parsed' | 'error'
    rows_total INT DEFAULT 0,
    rows_parsed INT DEFAULT 0,
    rows_unmatched INT DEFAULT 0,
    error_message TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    parsed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.time_clock_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on time_clock_uploads" ON public.time_clock_uploads;
CREATE POLICY "Allow all on time_clock_uploads" ON public.time_clock_uploads FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 5) Registros de checador (entrada/salida por empleado por día)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_clock_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id UUID NOT NULL REFERENCES public.time_clock_uploads(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    employee_code_raw TEXT,                -- código tal como venía en el archivo (por si no se pudo matchear)
    work_date DATE NOT NULL,
    check_in TIMESTAMP WITH TIME ZONE,
    check_out TIMESTAMP WITH TIME ZONE,
    hours_worked NUMERIC(6,2) DEFAULT 0,   -- horas totales del día
    overtime_hours NUMERIC(6,2) DEFAULT 0, -- horas extras del día
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tce_employee_date ON public.time_clock_entries(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_tce_date ON public.time_clock_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_tce_upload ON public.time_clock_entries(upload_id);

ALTER TABLE public.time_clock_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on time_clock_entries" ON public.time_clock_entries;
CREATE POLICY "Allow all on time_clock_entries" ON public.time_clock_entries FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 6) Periodos de nómina
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_type TEXT NOT NULL,             -- 'monthly' | 'biweekly' | 'weekly'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    payment_date DATE,
    status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'calculated' | 'approved' | 'paid'
    total_gross NUMERIC(14,2) DEFAULT 0,
    total_deductions NUMERIC(14,2) DEFAULT 0,
    total_net NUMERIC(14,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_period_dates ON public.payroll_periods(start_date, end_date, period_type);
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on payroll_periods" ON public.payroll_periods;
CREATE POLICY "Allow all on payroll_periods" ON public.payroll_periods FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 7) Recibos de nómina (uno por empleado por periodo)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    days_worked NUMERIC(6,2) DEFAULT 0,
    hours_worked NUMERIC(8,2) DEFAULT 0,
    overtime_hours NUMERIC(8,2) DEFAULT 0,
    -- Percepciones
    base_salary NUMERIC(12,2) DEFAULT 0,
    overtime_pay NUMERIC(12,2) DEFAULT 0,
    bonuses_total NUMERIC(12,2) DEFAULT 0,
    other_income NUMERIC(12,2) DEFAULT 0,     -- propinas, comisiones variables, etc.
    gross_salary NUMERIC(12,2) DEFAULT 0,
    -- Deducciones
    isr NUMERIC(12,2) DEFAULT 0,
    imss NUMERIC(12,2) DEFAULT 0,
    fixed_deductions NUMERIC(12,2) DEFAULT 0,
    other_deductions NUMERIC(12,2) DEFAULT 0,
    total_deductions NUMERIC(12,2) DEFAULT 0,
    -- Neto
    net_salary NUMERIC(12,2) DEFAULT 0,
    -- Auditoría
    payment_method TEXT,                       -- 'transfer' | 'cash' | 'check'
    payment_reference TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (period_id, employee_id)
);

ALTER TABLE public.payroll_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on payroll_receipts" ON public.payroll_receipts;
CREATE POLICY "Allow all on payroll_receipts" ON public.payroll_receipts FOR ALL USING (true) WITH CHECK (true);

-- Detalle línea por línea del recibo (percepciones y deducciones)
CREATE TABLE IF NOT EXISTS public.payroll_receipt_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES public.payroll_receipts(id) ON DELETE CASCADE,
    concept TEXT NOT NULL,
    type TEXT NOT NULL,                   -- 'perception' | 'deduction'
    amount NUMERIC(12,2) NOT NULL,
    is_taxable BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.payroll_receipt_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on payroll_receipt_lines" ON public.payroll_receipt_lines;
CREATE POLICY "Allow all on payroll_receipt_lines" ON public.payroll_receipt_lines FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 8) Declaraciones mensuales (IVA / ISR provisional / DIOT)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monthly_declarations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period TEXT NOT NULL,                 -- 'YYYY-MM'
    declaration_type TEXT NOT NULL,       -- 'IVA' | 'ISR_PROVISIONAL' | 'DIOT' | 'ANUAL'
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'filed' | 'paid' | 'complement'
    due_date DATE,
    filed_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    folio_sat TEXT,                       -- folio de acuse del SAT
    -- Resumen rápido
    total_to_pay NUMERIC(14,2) DEFAULT 0,
    in_favor NUMERIC(14,2) DEFAULT 0,     -- saldo a favor
    pdf_url TEXT,                         -- archivo de la declaración (PDF/imagen)
    pdf_file_name TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (period, declaration_type)
);

CREATE INDEX IF NOT EXISTS idx_md_period ON public.monthly_declarations(period);
ALTER TABLE public.monthly_declarations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on monthly_declarations" ON public.monthly_declarations;
CREATE POLICY "Allow all on monthly_declarations" ON public.monthly_declarations FOR ALL USING (true) WITH CHECK (true);

-- Detalle IVA
CREATE TABLE IF NOT EXISTS public.declaration_iva (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    declaration_id UUID NOT NULL REFERENCES public.monthly_declarations(id) ON DELETE CASCADE,
    -- IVA cobrado (de ventas)
    iva_cobrado_16 NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_8 NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_0 NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_exento NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_total NUMERIC(14,2) DEFAULT 0,
    -- IVA acreditable (de compras)
    iva_acreditable_16 NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_8 NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_0 NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_exento NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_total NUMERIC(14,2) DEFAULT 0,
    -- Cálculo
    saldo_a_favor_anterior NUMERIC(14,2) DEFAULT 0,
    iva_a_pagar NUMERIC(14,2) DEFAULT 0,
    saldo_a_favor_nuevo NUMERIC(14,2) DEFAULT 0,
    -- Detalle ingresos
    ingresos_gravados_16 NUMERIC(14,2) DEFAULT 0,
    ingresos_gravados_8 NUMERIC(14,2) DEFAULT 0,
    ingresos_exentos NUMERIC(14,2) DEFAULT 0,
    -- Detalle deducciones
    deducciones_gravadas_16 NUMERIC(14,2) DEFAULT 0,
    deducciones_exentas NUMERIC(14,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.declaration_iva ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on declaration_iva" ON public.declaration_iva;
CREATE POLICY "Allow all on declaration_iva" ON public.declaration_iva FOR ALL USING (true) WITH CHECK (true);

-- Detalle ISR provisional
CREATE TABLE IF NOT EXISTS public.declaration_isr (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    declaration_id UUID NOT NULL REFERENCES public.monthly_declarations(id) ON DELETE CASCADE,
    -- Ingresos del periodo (coeficiente de utilidad simplificado)
    ingresos_nominales NUMERIC(14,2) DEFAULT 0,
    ingresos_acumulables NUMERIC(14,2) DEFAULT 0,
    -- Deducciones
    deducciones_autorizadas NUMERIC(14,2) DEFAULT 0,
    -- Base
    utilidad_fiscal NUMERIC(14,2) DEFAULT 0,
    -- Tasa y cálculo
    coeficiente_utilidad NUMERIC(6,4) DEFAULT 0,
    tasa_isr NUMERIC(6,4) DEFAULT 0,           -- 0.0125 = 1.25% (tasa general), 0.30 = 30% (régimen RESICO)
    -- Resultado
    isr_causado NUMERIC(14,2) DEFAULT 0,
    pagos_provisionales_anteriores NUMERIC(14,2) DEFAULT 0,
    isr_a_pagar NUMERIC(14,2) DEFAULT 0,
    -- Detalle régimen
    regimen TEXT,                              -- 'general' | 'resico' | 'plataformas'
    -- Notas y extra
    subsidio_aplicado NUMERIC(14,2) DEFAULT 0,
    isr_retenido_terceros NUMERIC(14,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.declaration_isr ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on declaration_isr" ON public.declaration_isr;
CREATE POLICY "Allow all on declaration_isr" ON public.declaration_isr FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 9) Movimientos bancarios (caja de ahorro / tracking)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_date DATE NOT NULL,
    type TEXT NOT NULL,                     -- 'income' | 'expense' | 'transfer'
    category TEXT,                          -- 'nomina' | 'impuestos' | 'proveedores' | 'clientes' | 'otro'
    concept TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    reference TEXT,
    related_type TEXT,                      -- 'payroll_period' | 'declaration' | 'purchase_order' | 'manual'
    related_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.bank_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on bank_movements" ON public.bank_movements;
CREATE POLICY "Allow all on bank_movements" ON public.bank_movements FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 10) Configuración fiscal (tasas default, topes, etc.)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.finance_settings (key, value, description) VALUES
    ('iva_rate_general', '0.16', 'Tasa general de IVA'),
    ('iva_rate_frontera', '0.08', 'Tasa IVA zona fronteriza'),
    ('isr_tasa_provisional', '0.0125', 'Tasa ISR pagos provisionales régimen general'),
    ('isr_tasa_resico', '0.025', 'Tasa ISR pagos provisionales RESICO'),
    ('uma_daily', '108.57', 'UMA diaria 2024'),
    ('sbc_factor', '1.0453', 'Factor de integración SBC'),
    ('imss_employee_pct', '0.030', '% cuota obrero IMSS aproximada'),
    ('rcv_employee_pct', '0.01125', '% RCV obrero'),
    ('company_name', '', 'Razón social para recibos'),
    ('company_rfc', '', 'RFC empresa')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on finance_settings" ON public.finance_settings;
CREATE POLICY "Allow all on finance_settings" ON public.finance_settings FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 11) Storage bucket para PDFs de declaraciones y archivos del checador
-- -----------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('finance_files', 'finance_files', true, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read finance_files" ON storage.objects
    FOR SELECT USING (bucket_id = 'finance_files');
CREATE POLICY "Anon insert finance_files" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'finance_files');
CREATE POLICY "Anon update finance_files" ON storage.objects
    FOR UPDATE USING (bucket_id = 'finance_files');
CREATE POLICY "Anon delete finance_files" ON storage.objects
    FOR DELETE USING (bucket_id = 'finance_files');

-- -----------------------------------------------------
-- 12) Helper view: ingresos y IVA por mes (desde facturas emitidas)
-- -----------------------------------------------------
CREATE OR REPLACE VIEW public.v_monthly_sales_iva AS
SELECT
    to_char(coalesce(invoice_date, created_at), 'YYYY-MM') AS period,
    COUNT(*) AS invoice_count,
    COALESCE(SUM(subtotal), 0) AS ingresos_gravados,
    COALESCE(SUM(vat_total), 0) AS iva_cobrado,
    COALESCE(SUM(total), 0) AS total_cobrado
FROM public.issued_invoices
GROUP BY to_char(coalesce(invoice_date, created_at), 'YYYY-MM');
