-- =====================================================
-- OT: ESCRITURAS SÓLO DESDE EL SERVIDOR
--
-- Aplicar DESPUÉS de publicar la versión que usa las funciones de
-- 20261124171000 (la anterior escribía work_orders desde el navegador).
--
-- Con esto el estado de una OT, sus liberaciones de Calidad y sus pausas ya
-- no se pueden alterar con la llave pública: sólo por las acciones del
-- servidor, que validan permisos y dejan autor en la bitácora. Las notas de
-- la OT quedan realmente "sólo agregar" (no se editan ni se borran).
-- =====================================================

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.work_orders, public.work_order_qc_records, public.work_order_pauses,
    public.work_order_wps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_orders, public.work_order_qc_records, public.work_order_pauses, public.work_order_wps TO anon, authenticated;
GRANT ALL ON public.work_orders, public.work_order_qc_records, public.work_order_pauses, public.work_order_wps TO service_role;

REVOKE UPDATE, DELETE, TRUNCATE ON public.work_order_notes FROM PUBLIC, anon, authenticated;

-- El alta anterior (una etapa) ya no se expone a la llave pública.
REVOKE ALL ON FUNCTION public.create_work_order(jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_work_order(jsonb, uuid[]) TO service_role;

COMMIT;
