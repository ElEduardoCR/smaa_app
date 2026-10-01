-- =====================================================
-- Paso que faltaba para que el esquema se pueda reconstruir desde cero.
--
-- 20260721120000 creó `employees` como tabla de RRHH (code, rfc, hire_date…).
-- En producción esa tabla se renombró a mano a `payroll_employees` antes de
-- 20260722150000, que crea la nueva `employees` (usuarios del sistema).
-- Sin este paso, en una base limpia `CREATE TABLE IF NOT EXISTS employees`
-- no hace nada y fallan 5 migraciones posteriores (unify_employees,
-- doc_request_roles, payroll_foundations, normalize_employee_codes,
-- redesign_time_clock_imports).
--
-- Además, el trigger de 20260722220000 crea registros de nómina sin
-- full_name, así que esa columna no puede seguir siendo obligatoria.
--
-- En producción esto no hace nada: payroll_employees ya existe.
-- =====================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'hire_date'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'payroll_employees'
    ) THEN
        ALTER TABLE public.employees RENAME TO payroll_employees;
        ALTER TABLE public.payroll_employees ALTER COLUMN full_name DROP NOT NULL;
    END IF;
END $$;
