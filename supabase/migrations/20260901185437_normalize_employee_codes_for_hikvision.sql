-- Normaliza el número externo usado por Hikvision: EMP-005 -> EMP005.
-- attendance_events permanece intacta; sus filas históricas conservan el
-- employee_external_no recibido y siguen vinculadas por employees.id.

LOCK TABLE public.payroll_employees IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT replace(code, '-', '')
        FROM public.payroll_employees
        GROUP BY replace(code, '-', '')
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'No se pueden quitar guiones: existen códigos normalizados duplicados.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.payroll_employees
        WHERE code IS NULL OR btrim(replace(code, '-', '')) = ''
    ) THEN
        RAISE EXCEPTION 'No se pueden quitar guiones: existe un código vacío o nulo.';
    END IF;
END;
$$;

UPDATE public.payroll_employees
SET code = replace(code, '-', '')
WHERE code LIKE '%-%';

ALTER TABLE public.payroll_employees
    DROP CONSTRAINT IF EXISTS payroll_employees_code_no_hyphen_chk;

ALTER TABLE public.payroll_employees
    ADD CONSTRAINT payroll_employees_code_no_hyphen_chk
    CHECK (code !~ '-');

CREATE OR REPLACE FUNCTION public.tg_create_payroll_employee_stub()
RETURNS TRIGGER AS $$
DECLARE
    v_next_num INT;
BEGIN
    -- Serializa la asignación para evitar que dos altas simultáneas elijan
    -- el mismo correlativo.
    PERFORM pg_advisory_xact_lock(hashtext('smaa_payroll_employee_code'));

    SELECT COALESCE(
        MAX((regexp_match(code, '^EMP([0-9]+)$'))[1]::INT),
        0
    ) + 1
    INTO v_next_num
    FROM public.payroll_employees
    WHERE code ~ '^EMP[0-9]+$';

    INSERT INTO public.payroll_employees (employee_id, code, status, hire_date)
    VALUES (NEW.id, 'EMP' || LPAD(v_next_num::TEXT, 3, '0'), 'active', CURRENT_DATE)
    ON CONFLICT (employee_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON CONSTRAINT payroll_employees_code_no_hyphen_chk
    ON public.payroll_employees IS
    'El número externo debe ser compatible con terminales Hikvision que no aceptan guiones.';
