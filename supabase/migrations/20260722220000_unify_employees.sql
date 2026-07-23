-- =====================================================
-- Unificar la tabla de empleados
-- =====================================================
-- Hasta ahora había dos "empleados":
--   - public.employees       → tabla nueva para acceso al sistema (login, rol, permisos)
--   - public.payroll_employees → tabla vieja de RRHH con datos de nómina (RFC, salario, etc.)
--
-- Datos duplicados: full_name, position, phone, photo_url. Para dar de alta
-- a un usuario había que crearlo DOS veces (en /settings/employees y luego
-- otra vez en /finance/employees).
--
-- Solución:
--   - public.employees es la fuente de verdad para datos compartidos (nombre,
--     puesto, teléfono, foto) + autenticación.
--   - public.payroll_employees se vuelve una extensión 1:1 con FK a employees,
--     contiene SOLO datos de nómina (RFC, CURP, configuración de pago, banco, etc.).
--   - Cuando se crea un empleado en /settings/employees, un trigger crea
--     automáticamente un stub en payroll_employees (código, status=active,
--     hire_date=hoy). El admin después llena RFC, salario, etc.
--   - /finance/employees lista a todos los empleados de la tabla employees y
--     muestra cuáles tienen datos de nómina capturados.
-- =====================================================

-- 1) Add employee_id FK to payroll_employees (1:1 link)
ALTER TABLE public.payroll_employees
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE;

-- 2) Unique index ensures 1:1 (at most one payroll row per employee)
--    Sin WHERE para que Postgres pueda usar el índice en ON CONFLICT
--    (los NULL son distintos por default, no necesitamos el WHERE).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_employees_employee_id
  ON public.payroll_employees(employee_id);

-- 3) Trigger: auto-create a stub payroll_employees row when a new employee is inserted
CREATE OR REPLACE FUNCTION public.tg_create_payroll_employee_stub()
RETURNS TRIGGER AS $$
DECLARE
    v_next_num INT;
BEGIN
    -- Siguiente correlativo 'EMP-NNN'. MAX sobre todos los códigos existentes.
    SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 'EMP-(\d+)') AS INT)), 0) + 1
    INTO v_next_num
    FROM public.payroll_employees
    WHERE code ~ '^EMP-\d+$';

    INSERT INTO public.payroll_employees (employee_id, code, status, hire_date)
    VALUES (NEW.id, 'EMP-' || LPAD(v_next_num::TEXT, 3, '0'), 'active', CURRENT_DATE)
    ON CONFLICT (employee_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_payroll_employee_stub ON public.employees;
CREATE TRIGGER trg_create_payroll_employee_stub
    AFTER INSERT ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.tg_create_payroll_employee_stub();

-- 4) Backfill: crea stub para todos los empleados que ya existen
WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
    FROM public.employees
)
INSERT INTO public.payroll_employees (employee_id, code, status, hire_date)
SELECT n.id, 'EMP-' || LPAD(n.rn::TEXT, 3, '0'), 'active', CURRENT_DATE
FROM numbered n
LEFT JOIN public.payroll_employees pe ON pe.employee_id = n.id
WHERE pe.id IS NULL;

-- 5) Self-healing: re-apunta las FKs de tablas relacionadas si quedaron
--    ligadas al id viejo de payroll_employees (en lugar del employee_id nuevo)
DO $$
DECLARE
    r RECORD;
BEGIN
    -- employee_bonuses.employee_id
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'employee_bonuses_employee_id_fkey'
        AND table_name = 'employee_bonuses'
    ) THEN
        FOR r IN
            SELECT 1 FROM pg_constraint
            WHERE conname = 'employee_bonuses_employee_id_fkey'
              AND confrelid::regclass::text = 'payroll_employees'
        LOOP
            ALTER TABLE public.employee_bonuses DROP CONSTRAINT employee_bonuses_employee_id_fkey;
            ALTER TABLE public.employee_bonuses
                ADD CONSTRAINT employee_bonuses_employee_id_fkey
                FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;
            RAISE NOTICE 'employee_bonuses FK reparada → employees';
        END LOOP;
    END IF;

    -- employee_deductions.employee_id
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'employee_deductions_employee_id_fkey'
        AND table_name = 'employee_deductions'
    ) THEN
        FOR r IN
            SELECT 1 FROM pg_constraint
            WHERE conname = 'employee_deductions_employee_id_fkey'
              AND confrelid::regclass::text = 'payroll_employees'
        LOOP
            ALTER TABLE public.employee_deductions DROP CONSTRAINT employee_deductions_employee_id_fkey;
            ALTER TABLE public.employee_deductions
                ADD CONSTRAINT employee_deductions_employee_id_fkey
                FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;
            RAISE NOTICE 'employee_deductions FK reparada → employees';
        END LOOP;
    END IF;

    -- payroll_receipts.employee_id (ya debería estar OK del script anterior)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'payroll_receipts_employee_id_fkey'
        AND table_name = 'payroll_receipts'
    ) THEN
        FOR r IN
            SELECT 1 FROM pg_constraint
            WHERE conname = 'payroll_receipts_employee_id_fkey'
              AND confrelid::regclass::text = 'payroll_employees'
        LOOP
            ALTER TABLE public.payroll_receipts DROP CONSTRAINT payroll_receipts_employee_id_fkey;
            ALTER TABLE public.payroll_receipts
                ADD CONSTRAINT payroll_receipts_employee_id_fkey
                FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
            RAISE NOTICE 'payroll_receipts FK reparada → employees';
        END LOOP;
    END IF;

    -- time_clock_entries.employee_id (probablemente apuntaba a payroll_employees)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'time_clock_entries_employee_id_fkey'
        AND table_name = 'time_clock_entries'
    ) THEN
        FOR r IN
            SELECT 1 FROM pg_constraint
            WHERE conname = 'time_clock_entries_employee_id_fkey'
              AND confrelid::regclass::text = 'payroll_employees'
        LOOP
            ALTER TABLE public.time_clock_entries DROP CONSTRAINT time_clock_entries_employee_id_fkey;
            ALTER TABLE public.time_clock_entries
                ADD CONSTRAINT time_clock_entries_employee_id_fkey
                FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;
            RAISE NOTICE 'time_clock_entries FK reparada → employees';
        END LOOP;
    END IF;
END $$;

-- 6) Asegurar RLS permissive (consistente con el resto del schema)
ALTER TABLE public.payroll_employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on payroll_employees" ON public.payroll_employees;
CREATE POLICY "Allow all on payroll_employees" ON public.payroll_employees FOR ALL USING (true) WITH CHECK (true);
