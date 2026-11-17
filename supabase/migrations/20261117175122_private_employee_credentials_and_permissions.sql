-- Employee identity, roles, credentials and permissions are maintained through
-- authorized server actions. A public API key is never an employee session.
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employees FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.employees TO service_role;

-- Keep explicit profile selectors used by existing modules working, while
-- removing password hashes from the public projection. Revoke any legacy
-- column grants as well as table grants before rebuilding that projection.
DO $$
DECLARE v_all_columns text; v_profile_columns text;
BEGIN
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum),
           string_agg(quote_ident(attname),',' ORDER BY attnum) FILTER (WHERE attname <> 'password_hash')
    INTO v_all_columns,v_profile_columns
    FROM pg_attribute WHERE attrelid='public.employees'::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.employees FROM PUBLIC,anon,authenticated', v_all_columns);
    EXECUTE format('GRANT SELECT (%s) ON public.employees TO anon,authenticated', v_profile_columns);
END;
$$;

DROP POLICY IF EXISTS employee_profile_read ON public.employees;
CREATE POLICY employee_profile_read ON public.employees FOR SELECT TO anon,authenticated USING(true);
DROP POLICY IF EXISTS employee_identity_server_insert ON public.employees;
CREATE POLICY employee_identity_server_insert ON public.employees AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(false);
DROP POLICY IF EXISTS employee_identity_server_update ON public.employees;
CREATE POLICY employee_identity_server_update ON public.employees AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(false) WITH CHECK(false);
DROP POLICY IF EXISTS employee_identity_server_delete ON public.employees;
CREATE POLICY employee_identity_server_delete ON public.employees AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(false);

ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_permissions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.employee_permissions TO service_role;
DO $$
DECLARE v_columns text;
BEGIN
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO v_columns
    FROM pg_attribute WHERE attrelid='public.employee_permissions'::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.employee_permissions FROM PUBLIC,anon,authenticated',v_columns);
END;
$$;
DROP POLICY IF EXISTS employee_permissions_server_only ON public.employee_permissions;
CREATE POLICY employee_permissions_server_only ON public.employee_permissions AS RESTRICTIVE
FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);

-- The legacy employee audit trigger records changed values, including hashes.
-- Protect both earlier and future credential rows without hiding other logs.
ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_credentials_logs_server_only ON public.change_log;
CREATE POLICY employee_credentials_logs_server_only ON public.change_log AS RESTRICTIVE
FOR ALL TO anon,authenticated
USING (NOT (entity_type='employee' AND field_name IS NOT DISTINCT FROM 'password_hash'))
WITH CHECK (NOT (entity_type='employee' AND field_name IS NOT DISTINCT FROM 'password_hash'));
