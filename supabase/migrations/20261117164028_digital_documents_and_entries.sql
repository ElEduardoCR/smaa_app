-- Digital source catalogue and immutable PDF evidence for each saved revision.
-- The application authenticates employees with its own signed cookie. Only
-- authorized server actions may access captures; the public anon key cannot.

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS source_key text UNIQUE,
    ADD COLUMN IF NOT EXISTS digital_kind text,
    ADD COLUMN IF NOT EXISTS area text,
    ADD COLUMN IF NOT EXISTS priority_order integer,
    ADD COLUMN IF NOT EXISTS source_files jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_is_example boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS needs_adaptation boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS template_schema jsonb;

ALTER TABLE public.document_versions
    ADD COLUMN IF NOT EXISTS source_key text,
    ADD COLUMN IF NOT EXISTS digital_kind text,
    ADD COLUMN IF NOT EXISTS area text,
    ADD COLUMN IF NOT EXISTS priority_order integer,
    ADD COLUMN IF NOT EXISTS source_files jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_is_example boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS needs_adaptation boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS template_schema jsonb,
    ADD COLUMN IF NOT EXISTS document_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.update_digital_document_content(
    p_document_id uuid, p_expected_revision integer, p_template_schema jsonb,
    p_content text, p_actor_name text, p_change_summary text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
    v_doc public.documents%ROWTYPE;
    v_version text;
BEGIN
    SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id FOR UPDATE;
    IF NOT FOUND OR v_doc.template_schema IS NULL THEN RAISE EXCEPTION 'Documento digital no encontrado'; END IF;
    IF v_doc.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'El documento cambió. Actualiza antes de guardar'; END IF;
    IF v_doc.status IN ('obsolete', 'pending_obsolete') THEN RAISE EXCEPTION 'No se puede editar un documento obsoleto'; END IF;
    IF jsonb_typeof(p_template_schema) <> 'object' OR p_template_schema->>'key' IS DISTINCT FROM v_doc.source_key
        OR p_template_schema->>'code' IS DISTINCT FROM v_doc.folio
        OR nullif(btrim(p_template_schema->>'title'), '') IS NULL OR length(p_template_schema->>'title') > 400
        OR nullif(btrim(p_actor_name), '') IS NULL OR nullif(btrim(p_content), '') IS NULL
        OR octet_length(p_content) > 1048576 OR octet_length(p_template_schema::text) > 2097152 THEN
        RAISE EXCEPTION 'Contenido de documento no válido';
    END IF;
    INSERT INTO public.document_versions(document_id, version, revision, title, objective, scope, definitions,
        responsibilities, content, document_references, records, keywords, change_summary, changed_by,
        source_key, digital_kind, area, priority_order, source_files, source_is_example, needs_adaptation,
        template_schema, document_snapshot)
    VALUES(v_doc.id, v_doc.version, v_doc.revision, v_doc.title, v_doc.objective, v_doc.scope, v_doc.definitions,
        v_doc.responsibilities, v_doc.content, v_doc.document_references, v_doc.records, v_doc.keywords,
        coalesce(nullif(btrim(p_change_summary), ''), 'Actualización del contenido digital'), p_actor_name,
        v_doc.source_key, v_doc.digital_kind, v_doc.area, v_doc.priority_order, v_doc.source_files,
        v_doc.source_is_example, v_doc.needs_adaptation, v_doc.template_schema, to_jsonb(v_doc));
    v_version := public.bump_version(v_doc.version, 'minor');
    UPDATE public.documents SET title = p_template_schema->>'title', template_schema = p_template_schema,
        content = p_content, version = v_version, revision = v_doc.revision + 1, status = 'draft',
        approval_name = NULL, approval_role = NULL, approval_signature_url = NULL, approval_signed_at = NULL,
        effective_date = NULL, next_review_date = NULL, updated_at = now()
    WHERE id = p_document_id;
    RETURN jsonb_build_object('id', p_document_id, 'revision', v_doc.revision + 1, 'version', v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.update_digital_document_content(uuid,integer,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_digital_document_content(uuid,integer,jsonb,text,text,text) TO service_role;

CREATE TABLE IF NOT EXISTS public.document_entry_counters (
    document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    calendar_year integer NOT NULL,
    last_number integer NOT NULL CHECK (last_number > 0),
    PRIMARY KEY (document_id, calendar_year)
);

CREATE TABLE IF NOT EXISTS public.document_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
    folio text NOT NULL UNIQUE,
    revision integer NOT NULL CHECK (revision > 0),
    template_version text NOT NULL,
    template_revision integer NOT NULL,
    template_snapshot jsonb NOT NULL CHECK (jsonb_typeof(template_snapshot) = 'object'),
    values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object'),
    status text NOT NULL CHECK (status IN ('draft', 'finalized')),
    created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by_name text NOT NULL,
    updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    updated_by_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finalized_at timestamptz
);
CREATE INDEX IF NOT EXISTS document_entries_document_idx ON public.document_entries(document_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS document_entries_author_idx ON public.document_entries(created_by, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.document_entry_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id uuid NOT NULL REFERENCES public.document_entries(id) ON DELETE RESTRICT,
    revision integer NOT NULL CHECK (revision > 0),
    template_version text NOT NULL,
    template_revision integer NOT NULL,
    template_snapshot jsonb NOT NULL CHECK (jsonb_typeof(template_snapshot) = 'object'),
    values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object'),
    status text NOT NULL CHECK (status IN ('draft', 'finalized')),
    pdf_path text NOT NULL UNIQUE,
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    pdf_size integer NOT NULL CHECK (pdf_size > 0 AND pdf_size <= 26214400),
    created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(entry_id, revision)
);

ALTER TABLE public.document_entry_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_entry_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_entry_counters, public.document_entries, public.document_entry_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.document_entry_counters, public.document_entries TO service_role;
GRANT SELECT, INSERT ON public.document_entry_versions TO service_role;

CREATE OR REPLACE FUNCTION public.digital_next_entry_folio(p_document_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
    v_code text;
    v_year integer := extract(year FROM now() AT TIME ZONE 'America/Chihuahua')::integer;
    v_number integer;
BEGIN
    SELECT folio INTO v_code FROM public.documents WHERE id = p_document_id AND template_schema IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Formato digital no encontrado'; END IF;
    INSERT INTO public.document_entry_counters(document_id, calendar_year, last_number)
    VALUES(p_document_id, v_year, 1)
    ON CONFLICT(document_id, calendar_year) DO UPDATE
    SET last_number = public.document_entry_counters.last_number + 1
    RETURNING last_number INTO v_number;
    RETURN v_code || '/' || v_year || '/' || lpad(v_number::text, greatest(4, length(v_number::text)), '0');
END;
$$;
REVOKE ALL ON FUNCTION public.digital_next_entry_folio(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.digital_next_entry_folio(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.save_digital_entry(
    p_entry_id uuid, p_document_id uuid, p_expected_revision integer, p_folio text,
    p_template_version text, p_template_revision integer, p_template_snapshot jsonb,
    p_values jsonb, p_status text, p_actor_id uuid, p_actor_name text, p_can_edit boolean,
    p_pdf_path text, p_sha256 text, p_pdf_size integer, p_saved_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
    v_doc public.documents%ROWTYPE;
    v_entry public.document_entries%ROWTYPE;
    v_revision integer;
BEGIN
    IF p_status NOT IN ('draft', 'finalized') OR p_actor_id IS NULL OR nullif(btrim(p_actor_name), '') IS NULL THEN
        RAISE EXCEPTION 'Datos de captura no válidos';
    END IF;
    IF jsonb_typeof(p_values) <> 'object' OR octet_length(p_values::text) > 2097152 THEN
        RAISE EXCEPTION 'Contenido de captura no válido';
    END IF;
    IF p_pdf_path NOT LIKE 'entries/' || p_entry_id::text || '/%' OR p_pdf_path LIKE '%..%' THEN
        RAISE EXCEPTION 'Ruta PDF no válida';
    END IF;
    SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id FOR SHARE;
    IF NOT FOUND OR v_doc.template_schema IS NULL THEN RAISE EXCEPTION 'Formato digital no encontrado'; END IF;
    IF v_doc.status IN ('obsolete', 'pending_obsolete') THEN RAISE EXCEPTION 'El formato está obsoleto'; END IF;
    IF v_doc.template_schema IS DISTINCT FROM p_template_snapshot OR v_doc.version IS DISTINCT FROM p_template_version
        OR v_doc.revision IS DISTINCT FROM p_template_revision THEN
        RAISE EXCEPTION 'El formato cambió. Abre una nueva captura con la versión vigente';
    END IF;
    SELECT * INTO v_entry FROM public.document_entries WHERE id = p_entry_id FOR UPDATE;
    IF FOUND THEN
        IF v_entry.document_id <> p_document_id THEN RAISE EXCEPTION 'La captura pertenece a otro documento'; END IF;
        IF v_entry.status = 'finalized' THEN RAISE EXCEPTION 'La captura finalizada es inmutable'; END IF;
        IF v_entry.created_by IS DISTINCT FROM p_actor_id AND NOT p_can_edit THEN RAISE EXCEPTION 'Sin permiso para editar esta captura'; END IF;
        IF p_expected_revision IS DISTINCT FROM v_entry.revision THEN RAISE EXCEPTION 'La captura cambió. Actualiza antes de guardar'; END IF;
        IF v_entry.template_snapshot IS DISTINCT FROM p_template_snapshot OR v_entry.template_version <> p_template_version
            OR v_entry.template_revision <> p_template_revision THEN RAISE EXCEPTION 'La captura utiliza otra versión del formato'; END IF;
        v_revision := v_entry.revision + 1;
        UPDATE public.document_entries SET revision = v_revision, values = p_values, status = p_status,
            updated_by = p_actor_id, updated_by_name = p_actor_name, updated_at = p_saved_at,
            finalized_at = CASE WHEN p_status = 'finalized' THEN p_saved_at ELSE NULL END
        WHERE id = p_entry_id;
    ELSE
        IF coalesce(p_expected_revision, 0) <> 0 OR nullif(p_folio, '') IS NULL THEN RAISE EXCEPTION 'Nueva captura no válida'; END IF;
        v_revision := 1;
        INSERT INTO public.document_entries(id, document_id, folio, revision, template_version, template_revision,
            template_snapshot, values, status, created_by, created_by_name, updated_by, updated_by_name,
            created_at, updated_at, finalized_at)
        VALUES(p_entry_id, p_document_id, p_folio, v_revision, p_template_version, p_template_revision,
            p_template_snapshot, p_values, p_status, p_actor_id, p_actor_name, p_actor_id, p_actor_name,
            p_saved_at, p_saved_at, CASE WHEN p_status = 'finalized' THEN p_saved_at ELSE NULL END);
    END IF;
    INSERT INTO public.document_entry_versions(entry_id, revision, template_version, template_revision,
        template_snapshot, values, status, pdf_path, sha256, pdf_size, created_by, created_by_name, created_at)
    VALUES(p_entry_id, v_revision, p_template_version, p_template_revision, p_template_snapshot, p_values,
        p_status, p_pdf_path, p_sha256, p_pdf_size, p_actor_id, p_actor_name, p_saved_at);
    INSERT INTO public.change_log(entity_type, entity_id, action, description, changed_by, source, metadata)
    VALUES('document_entry', p_entry_id::text, CASE WHEN v_revision = 1 THEN 'create' ELSE 'update' END,
        'Captura ' || coalesce(v_entry.folio, p_folio) || ', revisión ' || v_revision || ' (' || p_status || ')',
        p_actor_name, 'app', jsonb_build_object('revision', v_revision, 'sha256', p_sha256, 'document_id', p_document_id));
    RETURN jsonb_build_object('id', p_entry_id, 'revision', v_revision);
END;
$$;
REVOKE ALL ON FUNCTION public.save_digital_entry(uuid,uuid,integer,text,text,integer,jsonb,jsonb,text,uuid,text,boolean,text,text,integer,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_digital_entry(uuid,uuid,integer,text,text,integer,jsonb,jsonb,text,uuid,text,boolean,text,text,integer,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_digital_entry_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_TABLE_NAME = 'document_entry_versions' THEN
        RAISE EXCEPTION 'El historial de capturas y sus PDF es inmutable';
    END IF;
    IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'La captura finalizada es inmutable'; END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_digital_entry_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS document_entries_immutable_final ON public.document_entries;
CREATE TRIGGER document_entries_immutable_final BEFORE UPDATE OR DELETE ON public.document_entries
    FOR EACH ROW EXECUTE FUNCTION public.guard_digital_entry_history();
DROP TRIGGER IF EXISTS document_entry_versions_immutable ON public.document_entry_versions;
CREATE TRIGGER document_entry_versions_immutable BEFORE UPDATE OR DELETE ON public.document_entry_versions
    FOR EACH ROW EXECUTE FUNCTION public.guard_digital_entry_history();

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES('digital-document-pdfs', 'digital-document-pdfs', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT(id) DO UPDATE SET public = false, file_size_limit = 26214400, allowed_mime_types = ARRAY['application/pdf'];
-- No public Storage policies: access is signed by the authorized server only.

COMMENT ON TABLE public.document_entries IS 'Digital captures authorized through the SMAA server, with optimistic concurrency and immutable finalized records.';
COMMENT ON TABLE public.document_entry_versions IS 'Exact template, values, author and SHA-256 of the private PDF archived at each save.';
