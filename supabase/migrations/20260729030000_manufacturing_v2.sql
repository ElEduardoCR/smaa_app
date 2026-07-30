-- =====================================================
-- MANUFACTURING v2 — Operators M:N, Notes append-only, File versions
-- 2026-07-29
--
-- Cambios:
--   1) work_order_operators  (N:M)  — varios empleados por OT
--   2) work_order_notes       append-only — historial de notas, nunca se borran
--   3) work_order_files.is_current — marca la última versión por file_kind
--      + trigger que actualiza is_current al subir un nuevo archivo del mismo kind
--   4) Migrar work_orders.notes legacy → work_order_notes
--   5) Mantener work_orders.operator_name (legacy) + operator_signature_url
-- =====================================================

-- -----------------------------------------------------
-- 1) work_order_operators (M:N) — varios empleados por OT
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_operators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    role TEXT NOT NULL DEFAULT 'operator',  -- 'operator' | 'supervisor' | 'qc' | 'helper'
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    UNIQUE (work_order_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_wo_operators_wo
    ON public.work_order_operators (work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_operators_emp
    ON public.work_order_operators (employee_id);

ALTER TABLE public.work_order_operators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all work_order_operators" ON public.work_order_operators;
CREATE POLICY "Allow all work_order_operators" ON public.work_order_operators
    FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 2) work_order_notes (append-only) — historial de notas
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by_name TEXT,        -- snapshot del nombre por si se borra el empleado
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_notes_wo_created
    ON public.work_order_notes (work_order_id, created_at DESC);

ALTER TABLE public.work_order_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all work_order_notes" ON public.work_order_notes;
CREATE POLICY "Allow all work_order_notes" ON public.work_order_notes
    FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3) work_order_files.is_current — versión actual por file_kind
-- -----------------------------------------------------
ALTER TABLE public.work_order_files
    ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT true;

-- Trigger: al insertar un archivo del mismo file_kind para el mismo work_order,
-- marcar is_current=false en los anteriores y true en el nuevo.
-- Para file_kind='other' (misceláneos) no aplicamos la regla de "versión actual".
CREATE OR REPLACE FUNCTION public.work_order_file_set_current()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.file_kind IS NOT NULL AND NEW.file_kind <> 'other' THEN
        UPDATE public.work_order_files
           SET is_current = false
         WHERE work_order_id = NEW.work_order_id
           AND file_kind = NEW.file_kind
           AND id <> NEW.id
           AND is_current = true;
    END IF;
    NEW.is_current := true;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wo_file_set_current ON public.work_order_files;
CREATE TRIGGER trg_wo_file_set_current
    BEFORE INSERT ON public.work_order_files
    FOR EACH ROW EXECUTE FUNCTION public.work_order_file_set_current();

CREATE INDEX IF NOT EXISTS idx_wo_files_current
    ON public.work_order_files (work_order_id, file_kind, is_current) WHERE is_current = true;

-- -----------------------------------------------------
-- 4) Migrar work_orders.notes legacy a work_order_notes
-- -----------------------------------------------------
INSERT INTO public.work_order_notes (work_order_id, note, created_by_name, created_at)
SELECT
    id,
    notes,
    'Migrado de campo legacy',
    created_at
FROM public.work_orders
WHERE notes IS NOT NULL
  AND TRIM(notes) <> ''
  AND id NOT IN (SELECT work_order_id FROM public.work_order_notes);

COMMENT ON TABLE public.work_order_operators IS
    'Operadores asignados a la OT. M:N con employees. Una OT puede tener varios.';
COMMENT ON TABLE public.work_order_notes IS
    'Historial de notas append-only. Cada INSERT agrega una nota nueva; nunca se hace UPDATE ni DELETE.';
COMMENT ON COLUMN public.work_order_files.is_current IS
    'true = es la última versión subida de este file_kind en esta OT. Trigger mantiene esto automáticamente.';
