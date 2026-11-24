-- =====================================================
-- BITÁCORA DE EDICIONES (audit_log)
--
-- Cada alta, edición o baja de cotizaciones, compras, OT, entregas y cuentas
-- por cobrar queda registrada por un trigger: quién, cuándo, qué campo y el
-- valor anterior/nuevo. El trigger corre aunque el cambio no venga de la app
-- (API directa con la llave pública), así que nada se modifica sin rastro.
--
-- Autor del cambio:
--   1) Funciones del servidor: `set_config('smaa.actor_id', <empleado>, true)`.
--   2) Acciones del servidor con la llave de servicio: encabezado HTTP
--      `x-smaa-actor`. Sólo se confía en él si el JWT es `service_role`
--      (la llave de servicio nunca sale del servidor).
--   3) Cualquier otro origen queda como "navegador" o "base de datos", sin
--      autor: en la pantalla se marca como edición sin sesión verificada.
--
-- La tabla no se puede insertar, editar ni borrar con las llaves de la app;
-- sólo el trigger (SECURITY DEFINER) escribe, y el servidor la lee.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    table_name text NOT NULL,
    record_id text NOT NULL,
    -- Registro "padre" que agrupa el historial (p. ej. la cotización de una partida).
    root_table text NOT NULL,
    root_id text NOT NULL,
    operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    changed_fields text[],
    old_data jsonb,
    new_data jsonb,
    actor_id uuid,
    actor_name text,
    source text NOT NULL,
    reason text,
    txid bigint NOT NULL DEFAULT txid_current()
);

CREATE INDEX IF NOT EXISTS audit_log_root_idx ON public.audit_log (root_table, root_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON public.audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_id, occurred_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.audit_log TO service_role;
DROP POLICY IF EXISTS audit_log_server_read ON public.audit_log;
CREATE POLICY audit_log_server_read ON public.audit_log FOR SELECT TO service_role USING (true);

COMMENT ON TABLE public.audit_log IS
    'Historial inalterable de altas/ediciones/bajas. Sólo lo escribe audit_row_change(); el servidor lo lee con la llave de servicio.';

-- -----------------------------------------------------
-- Autor de la petición actual
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.smaa_request_actor(OUT actor_id uuid, OUT actor_name text, OUT source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_setting text := nullif(current_setting('smaa.actor_id', true), '');
    v_role text;
    v_candidate text;
BEGIN
    BEGIN
        v_role := nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role';
    EXCEPTION WHEN others THEN v_role := NULL;
    END;

    v_candidate := v_setting;
    IF v_candidate IS NULL AND v_role = 'service_role' THEN
        BEGIN
            v_candidate := nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-smaa-actor', '');
        EXCEPTION WHEN others THEN v_candidate := NULL;
        END;
    END IF;

    IF v_candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT e.id, e.full_name INTO actor_id, actor_name FROM public.employees e WHERE e.id = v_candidate::uuid;
    END IF;

    source := CASE
        WHEN actor_id IS NOT NULL THEN 'servidor'
        WHEN v_role = 'service_role' THEN 'servidor (sin usuario)'
        WHEN v_role IN ('anon', 'authenticated') THEN 'navegador'
        ELSE 'base de datos'
    END;
END;
$$;
REVOKE ALL ON FUNCTION public.smaa_request_actor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smaa_request_actor() TO service_role;

-- Marca el autor y el motivo para el resto de la transacción (lo usan las RPC).
CREATE OR REPLACE FUNCTION public.smaa_set_actor(p_actor_id uuid, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
    SELECT full_name INTO v_name FROM public.employees WHERE id = p_actor_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'El empleado no está activo'; END IF;
    PERFORM set_config('smaa.actor_id', p_actor_id::text, true);
    PERFORM set_config('smaa.reason', coalesce(left(btrim(p_reason), 1000), ''), true);
    RETURN v_name;
END;
$$;
REVOKE ALL ON FUNCTION public.smaa_set_actor(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smaa_set_actor(uuid, text) TO service_role;

-- -----------------------------------------------------
-- Trigger genérico
--   TG_ARGV[0] = tabla raíz del historial
--   TG_ARGV[1] = columna con el id de la raíz ('id' si es la misma tabla)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_old jsonb;
    v_new jsonb;
    v_changed text[];
    v_old_diff jsonb;
    v_new_diff jsonb;
    v_actor record;
    v_record_id text;
    v_root_id text;
    v_reason text := nullif(current_setting('smaa.reason', true), '');
BEGIN
    IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
    v_record_id := coalesce(v_new ->> 'id', v_old ->> 'id');
    v_root_id := coalesce(v_new ->> TG_ARGV[1], v_old ->> TG_ARGV[1], v_record_id);

    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(n.key ORDER BY n.key), jsonb_object_agg(n.key, v_old -> n.key), jsonb_object_agg(n.key, n.value)
          INTO v_changed, v_old_diff, v_new_diff
          FROM jsonb_each(v_new) AS n(key, value)
         WHERE n.key <> 'updated_at' AND (v_old -> n.key) IS DISTINCT FROM n.value;
        IF v_changed IS NULL THEN RETURN NULL; END IF;
    ELSIF TG_OP = 'INSERT' THEN
        v_new_diff := v_new;
    ELSE
        v_old_diff := v_old;
    END IF;

    SELECT * INTO v_actor FROM public.smaa_request_actor();
    -- Motivo enviado por una acción del servidor (encabezado en base64, UTF-8).
    IF v_reason IS NULL AND v_actor.actor_id IS NOT NULL THEN
        BEGIN
            IF nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role' = 'service_role' THEN
                v_reason := nullif(left(convert_from(decode(nullif(current_setting('request.headers', true), '')::json ->> 'x-smaa-reason', 'base64'), 'UTF8'), 1000), '');
            END IF;
        EXCEPTION WHEN others THEN v_reason := NULL;
        END;
    END IF;
    INSERT INTO public.audit_log (table_name, record_id, root_table, root_id, operation, changed_fields,
        old_data, new_data, actor_id, actor_name, source, reason)
    VALUES (TG_TABLE_NAME, coalesce(v_record_id, '?'), TG_ARGV[0], coalesce(v_root_id, '?'), TG_OP, v_changed,
        v_old_diff, v_new_diff, v_actor.actor_id, v_actor.actor_name, v_actor.source, v_reason);
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

-- Conecta el trigger a una tabla si existe (idempotente).
CREATE OR REPLACE FUNCTION public.smaa_attach_audit(p_table text, p_root_table text, p_root_column text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
    IF to_regclass('public.' || p_table) IS NULL THEN RETURN; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$I', p_table);
    EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
        FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%2$L, %3$L)', p_table, p_root_table, p_root_column);
END;
$$;
REVOKE ALL ON FUNCTION public.smaa_attach_audit(text, text, text) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    PERFORM public.smaa_attach_audit('quotations', 'quotations', 'id');
    PERFORM public.smaa_attach_audit('quotation_items', 'quotations', 'quotation_id');
    PERFORM public.smaa_attach_audit('purchase_orders', 'purchase_orders', 'id');
    PERFORM public.smaa_attach_audit('purchase_order_items', 'purchase_orders', 'purchase_order_id');
    PERFORM public.smaa_attach_audit('work_orders', 'work_orders', 'id');
    PERFORM public.smaa_attach_audit('work_order_wps', 'work_orders', 'work_order_id');
    PERFORM public.smaa_attach_audit('work_order_operators', 'work_orders', 'work_order_id');
    PERFORM public.smaa_attach_audit('deliveries', 'work_orders', 'work_order_id');
    PERFORM public.smaa_attach_audit('ar_invoices', 'ar_invoices', 'id');
END;
$$;

COMMIT;
