-- Controlled documents are company information. The application uses its own
-- signed employee session, so database requests are made only by authorized
-- server actions. Supabase anonymous/authenticated keys are not employee roles.
DO $$
DECLARE v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['documents','document_versions','document_signatures','document_requests'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role', v_table);
        EXECUTE format('DROP POLICY IF EXISTS controlled_documents_server_only ON public.%I', v_table);
        EXECUTE format('CREATE POLICY controlled_documents_server_only ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING (false) WITH CHECK (false)', v_table);
    END LOOP;
END;
$$;

ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS controlled_document_logs_server_only ON public.change_log;
CREATE POLICY controlled_document_logs_server_only ON public.change_log AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (entity_type NOT IN ('document','document_version','document_request','document_entry'))
WITH CHECK (entity_type NOT IN ('document','document_version','document_request','document_entry'));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.change_log TO service_role;

REVOKE ALL ON FUNCTION public.next_document_folio(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_document_folio(text) TO service_role;

CREATE OR REPLACE FUNCTION public.save_legacy_controlled_document(
    p_document_id uuid, p_expected_revision integer, p_payload jsonb, p_actor_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
    v_document public.documents%ROWTYPE;
    v_id uuid;
    v_folio text;
    v_prefix text;
    v_type uuid;
    v_version text;
BEGIN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
        OR nullif(btrim(p_payload->>'title'), '') IS NULL
        OR nullif(btrim(p_payload->>'content'), '') IS NULL
        OR nullif(btrim(p_actor_name), '') IS NULL THEN RAISE EXCEPTION 'El documento requiere título, contenido y autor'; END IF;
    v_type := nullif(p_payload->>'type_id', '')::uuid;
    SELECT prefix INTO v_prefix FROM public.document_types WHERE id = v_type AND is_active;
    IF NOT FOUND OR v_prefix !~ '^[A-Za-z0-9_-]{1,30}$' THEN RAISE EXCEPTION 'Tipo de documento no válido'; END IF;
    IF p_document_id IS NOT NULL THEN
        SELECT * INTO v_document FROM public.documents WHERE id = p_document_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
        IF v_document.status IN ('obsolete','pending_obsolete') THEN RAISE EXCEPTION 'No se puede editar un documento obsoleto'; END IF;
        IF v_document.template_schema IS NOT NULL THEN RAISE EXCEPTION 'Usa el editor del documento digital para conservar su estructura'; END IF;
        IF p_expected_revision IS DISTINCT FROM v_document.revision THEN RAISE EXCEPTION 'El documento cambió. Actualiza antes de guardar'; END IF;
        INSERT INTO public.document_versions(document_id,version,revision,title,objective,scope,definitions,responsibilities,
            content,document_references,records,keywords,change_summary,changed_by,document_snapshot)
        VALUES(v_document.id,v_document.version,v_document.revision,v_document.title,v_document.objective,v_document.scope,
            v_document.definitions,v_document.responsibilities,v_document.content,v_document.document_references,v_document.records,
            v_document.keywords,'Edición de contenido documental',p_actor_name,to_jsonb(v_document));
        v_version := public.bump_version(v_document.version,'minor');
        UPDATE public.documents SET type_id = v_type, title = btrim(p_payload->>'title'),
            objective = p_payload->>'objective', scope = p_payload->>'scope', definitions = p_payload->>'definitions',
            responsibilities = p_payload->>'responsibilities', content = p_payload->>'content',
            document_references = p_payload->>'document_references', records = p_payload->>'records', keywords = p_payload->>'keywords',
            version = v_version, revision = v_document.revision + 1, status = 'draft', effective_date = NULL,
            next_review_date = nullif(p_payload->>'next_review_date','')::date,
            approval_name = NULL, approval_role = NULL, approval_signature_url = NULL, approval_signed_at = NULL,
            updated_at = now()
        WHERE id = v_document.id RETURNING id,folio INTO v_id,v_folio;
    ELSE
        v_version := coalesce(nullif(p_payload->>'version',''),'1.0');
        IF v_version !~ '^[0-9]+\.[0-9]+$' THEN RAISE EXCEPTION 'La versión debe tener formato 1.0'; END IF;
        PERFORM pg_advisory_xact_lock(hashtext('smaa-controlled-document-folio:' || v_prefix));
        v_folio := public.next_document_folio(v_prefix);
        INSERT INTO public.documents(folio,type_id,title,objective,scope,definitions,responsibilities,content,document_references,
            records,keywords,version,revision,status,next_review_date,created_by)
        VALUES(v_folio,v_type,btrim(p_payload->>'title'),p_payload->>'objective',p_payload->>'scope',p_payload->>'definitions',
            p_payload->>'responsibilities',p_payload->>'content',p_payload->>'document_references',p_payload->>'records',
            p_payload->>'keywords',v_version,1,'draft',nullif(p_payload->>'next_review_date','')::date,p_actor_name)
        RETURNING id INTO v_id;
    END IF;
    RETURN jsonb_build_object('id',v_id,'folio',v_folio,'version',v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.save_legacy_controlled_document(uuid,integer,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_legacy_controlled_document(uuid,integer,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.sign_controlled_document(
    p_document_id uuid, p_expected_revision integer, p_actor_name text, p_actor_role text, p_signature_uri text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_document public.documents%ROWTYPE;
BEGIN
    IF nullif(btrim(p_actor_name),'') IS NULL OR p_signature_uri IS NULL
        OR p_signature_uri !~ '^storage://controlled-document-signatures/[a-zA-Z0-9/_-]+\.png$' THEN
        RAISE EXCEPTION 'Firma de aprobación no válida';
    END IF;
    SELECT * INTO v_document FROM public.documents WHERE id = p_document_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
    IF v_document.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'El documento cambió. Actualiza antes de firmar'; END IF;
    IF v_document.status NOT IN ('draft','in_review') THEN RAISE EXCEPTION 'Solo se puede aprobar un documento en borrador o revisión'; END IF;
    INSERT INTO public.document_signatures(document_id,version,signer_name,signer_role,signature_url,signed_at,purpose)
    VALUES(v_document.id,v_document.version,p_actor_name,p_actor_role,p_signature_uri,now(),'approval');
    UPDATE public.documents SET status='approved',approval_name=p_actor_name,approval_role=p_actor_role,
        approval_signature_url=p_signature_uri,approval_signed_at=now(),
        effective_date=coalesce(effective_date,(now() AT TIME ZONE 'America/Chihuahua')::date),updated_at=now()
    WHERE id = v_document.id;
    RETURN jsonb_build_object('id',v_document.id,'version',v_document.version);
END;
$$;
REVOKE ALL ON FUNCTION public.sign_controlled_document(uuid,integer,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_controlled_document(uuid,integer,text,text,text) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('controlled-document-signatures','controlled-document-signatures',false,1048576,ARRAY['image/png'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=1048576,allowed_mime_types=ARRAY['image/png'];
DO $$ BEGIN
    IF to_regclass('storage.objects') IS NOT NULL THEN
        DROP POLICY IF EXISTS controlled_document_signatures_private ON storage.objects;
        CREATE POLICY controlled_document_signatures_private ON storage.objects AS RESTRICTIVE
        FOR ALL TO anon,authenticated USING(bucket_id <> 'controlled-document-signatures')
        WITH CHECK(bucket_id <> 'controlled-document-signatures');
    END IF;
END; $$;
