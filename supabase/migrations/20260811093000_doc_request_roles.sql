-- =====================================================
-- Roles nuevos para el workflow de requisiciones de documentos.
--
-- Roles previos: master, operator, admin.
-- Nuevos:
--   - document_controller: revisa las requisiciones (1er filtro).
--   - top_management: aprueba y firma las requisiciones que pasaron
--     el filtro del controlador (Alta Dirección).
--
-- `employees.role` ya es `text`, así que técnicamente cualquier valor
-- encaja. Lo blindamos con un CHECK para evitar typos y dejar
-- explícito el contrato.
-- =====================================================

-- 1) Quitar check viejo si existe (idempotente)
ALTER TABLE public.employees
    DROP CONSTRAINT IF EXISTS employees_role_check;

-- 2) Agregar check con los 5 roles permitidos
ALTER TABLE public.employees
    ADD CONSTRAINT employees_role_check
    CHECK (role IN (
        'master',              -- superusuario (sin cambios)
        'operator',            -- operario (sin cambios)
        'admin',               -- admin de módulo (sin cambios)
        'document_controller', -- NUEVO: revisa requisiciones
        'top_management'       -- NUEVO: aprueba y firma requisiciones
    ));

-- 3) Comentario para documentación
COMMENT ON COLUMN public.employees.role IS
    'master | operator | admin | document_controller | top_management';
