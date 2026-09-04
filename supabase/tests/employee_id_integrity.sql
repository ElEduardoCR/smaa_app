-- =====================================================
-- Diagnóstico: ¿los employee_id apuntan a donde deben?
-- =====================================================
-- Córrelo ANTES y DESPUÉS de 20260831000000_payroll_foundations.sql.
--
-- Es solo SELECT: no modifica nada y se puede correr por cualquier vía
-- (psql, el MCP de Supabase, el SQL editor). Existe porque los RAISE NOTICE
-- de la migración no siempre llegan al cliente, y saber cuántas filas se
-- repararon no debería depender de eso.
--
-- Lectura esperada:
--   ANTES  → 'huerfana_remapeable' > 0  (son las filas rotas)
--   DESPUÉS→ todo en 'ok'; cualquier 'huerfana_perdida' hay que revisarla
--            a mano: es una fila que no corresponde a ningún empleado.
-- =====================================================

WITH clasificado AS (
    SELECT 'employee_bonuses' AS tabla, x.id, x.employee_id FROM public.employee_bonuses x
    UNION ALL
    SELECT 'employee_deductions', x.id, x.employee_id FROM public.employee_deductions x
    UNION ALL
    SELECT 'time_clock_entries', x.id, x.employee_id FROM public.time_clock_entries x
    UNION ALL
    SELECT 'payroll_receipts', x.id, x.employee_id FROM public.payroll_receipts x
)
SELECT
    c.tabla,
    CASE
        WHEN c.employee_id IS NULL THEN 'sin_empleado'
        WHEN EXISTS (SELECT 1 FROM public.employees e WHERE e.id = c.employee_id)
            THEN 'ok'
        WHEN EXISTS (SELECT 1 FROM public.payroll_employees pe
                      WHERE pe.id = c.employee_id AND pe.employee_id IS NOT NULL)
            THEN 'huerfana_remapeable'
        ELSE 'huerfana_perdida'
    END AS estado,
    COUNT(*) AS filas
FROM clasificado c
GROUP BY 1, 2
ORDER BY 1, 2;
