-- Publishing an approved change retains the controlled document's identity.
-- Request approval stores the actual signer's identity and signature rather
-- than attributing approval to the person who later presses Publish.
ALTER TABLE public.document_requests
    ADD COLUMN IF NOT EXISTS top_mgmt_signature_url text,
    ADD COLUMN IF NOT EXISTS top_mgmt_approver_name text,
    ADD COLUMN IF NOT EXISTS top_mgmt_approver_role text;
ALTER TABLE public.document_versions ADD COLUMN IF NOT EXISTS document_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.publish_document_request_atomic(
    p_request_id uuid, p_actor_id uuid, p_actor_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
    v_request public.document_requests%ROWTYPE;
    v_old public.documents%ROWTYPE;
    v_payload jsonb;
    v_document_id uuid;
    v_type_id uuid;
    v_prefix text;
    v_folio text;
    v_version text;
    v_schema jsonb;
    v_sections jsonb;
BEGIN
    IF p_actor_id IS NULL OR nullif(btrim(p_actor_name), '') IS NULL THEN
        RAISE EXCEPTION 'No hay un publicador identificado';
    END IF;
    SELECT * INTO v_request FROM public.document_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requisición no encontrada'; END IF;
    IF v_request.status <> 'approved' THEN RAISE EXCEPTION 'La requisición no está aprobada para publicar'; END IF;
    IF v_request.top_mgmt_approver IS NULL OR v_request.top_mgmt_approved_at IS NULL
        OR nullif(btrim(v_request.top_mgmt_signature_url), '') IS NULL
        OR nullif(btrim(v_request.top_mgmt_approver_name), '') IS NULL THEN
        RAISE EXCEPTION 'Alta Dirección debe firmar la aprobación antes de publicar';
    END IF;
    v_payload := v_request.payload;
    IF nullif(btrim(v_payload->>'title'), '') IS NULL OR nullif(btrim(v_payload->>'content'), '') IS NULL THEN
        RAISE EXCEPTION 'El documento requiere título y contenido';
    END IF;
    IF v_payload->>'version' IS NOT NULL AND v_payload->>'version' !~ '^[0-9]+\.[0-9]+$' THEN
        RAISE EXCEPTION 'La versión debe tener formato 1.0';
    END IF;

    IF v_request.type = 'change' THEN
        SELECT * INTO v_old FROM public.documents WHERE id = v_request.target_document_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Documento objetivo no encontrado'; END IF;
        IF v_old.status IN ('obsolete', 'pending_obsolete') THEN RAISE EXCEPTION 'El documento objetivo está obsoleto'; END IF;
        IF v_payload ? 'base_revision' AND (v_payload->>'base_revision')::integer IS DISTINCT FROM v_old.revision THEN
            RAISE EXCEPTION 'El documento cambió después de crear la requisición. Prepare una nueva solicitud con la versión vigente';
        END IF;
        INSERT INTO public.document_versions(document_id, version, revision, title, objective, scope,
            definitions, responsibilities, content, document_references, records, keywords,
            change_summary, changed_by, signature_url, source_key, digital_kind, area, priority_order,
            source_files, source_is_example, needs_adaptation, template_schema, document_snapshot)
        VALUES(v_old.id, v_old.version, v_old.revision, v_old.title, v_old.objective, v_old.scope,
            v_old.definitions, v_old.responsibilities, v_old.content, v_old.document_references, v_old.records, v_old.keywords,
            coalesce(v_request.change_summary, v_request.reason), p_actor_name, v_request.top_mgmt_signature_url,
            v_old.source_key, v_old.digital_kind, v_old.area, v_old.priority_order, v_old.source_files,
            v_old.source_is_example, v_old.needs_adaptation, v_old.template_schema, to_jsonb(v_old));

        v_schema := v_old.template_schema;
        IF v_schema IS NOT NULL THEN
            -- The request editor proposes prose. Field definitions, fixed rows,
            -- table keys, signature controls and process diagrams remain intact.
            SELECT coalesce(jsonb_agg(section - 'paragraphs' ORDER BY ordinal), '[]'::jsonb)
                INTO v_sections
            FROM jsonb_array_elements(v_schema->'sections') WITH ORDINALITY AS item(section, ordinal)
            WHERE section ? 'fields' OR section ? 'table' OR section ? 'flow';
            v_sections := jsonb_build_array(jsonb_build_object('title', 'Contenido aprobado',
                'paragraphs', jsonb_build_array(v_payload->>'content'))) || v_sections;
            v_schema := jsonb_set(jsonb_set(v_schema, '{sections}', v_sections), '{title}', to_jsonb(v_payload->>'title'));
        END IF;
        v_version := coalesce(nullif(v_payload->>'version', ''), public.bump_version(v_old.version, 'minor'));
        IF v_version = v_old.version THEN v_version := public.bump_version(v_old.version, 'minor'); END IF;
        UPDATE public.documents SET title = v_payload->>'title',
            objective = v_payload->>'objective', scope = v_payload->>'scope', definitions = v_payload->>'definitions',
            responsibilities = v_payload->>'responsibilities', content = v_payload->>'content',
            document_references = v_payload->>'document_references', records = v_payload->>'records', keywords = v_payload->>'keywords',
            effective_date = coalesce(nullif(v_payload->>'effective_date', '')::date, (now() AT TIME ZONE 'America/Chihuahua')::date),
            next_review_date = nullif(v_payload->>'next_review_date', '')::date,
            version = v_version, revision = v_old.revision + 1, status = 'approved', template_schema = v_schema,
            approval_name = v_request.top_mgmt_approver_name, approval_role = v_request.top_mgmt_approver_role,
            approval_signature_url = v_request.top_mgmt_signature_url, approval_signed_at = v_request.top_mgmt_approved_at,
            obsoleted_at = NULL, obsoleted_reason = NULL
        WHERE id = v_old.id;
        v_document_id := v_old.id;
    ELSE
        v_type_id := nullif(v_payload->>'type_id', '')::uuid;
        IF v_type_id IS NULL THEN
            SELECT id INTO v_type_id FROM public.document_types WHERE is_active ORDER BY (code = 'FOR') DESC, sort_order, code LIMIT 1;
        END IF;
        SELECT prefix INTO v_prefix FROM public.document_types WHERE id = v_type_id AND is_active;
        IF NOT FOUND THEN RAISE EXCEPTION 'Seleccione un tipo de documento activo'; END IF;
        -- Lock folio allocation and insertion together, avoiding duplicate folios
        -- if two approved requests for the same document type publish at once.
        PERFORM pg_advisory_xact_lock(hashtext('document_folio:' || v_prefix));
        v_folio := public.next_document_folio(v_prefix);
        v_version := coalesce(nullif(v_payload->>'version', ''), '1.0');
        INSERT INTO public.documents(folio, type_id, title, objective, scope, definitions, responsibilities,
            content, document_references, records, keywords, version, revision, status, effective_date, next_review_date,
            approval_name, approval_role, approval_signature_url, approval_signed_at, created_by)
        VALUES(v_folio, v_type_id, v_payload->>'title', v_payload->>'objective', v_payload->>'scope', v_payload->>'definitions',
            v_payload->>'responsibilities', v_payload->>'content', v_payload->>'document_references', v_payload->>'records',
            v_payload->>'keywords', v_version, 1, 'approved',
            coalesce(nullif(v_payload->>'effective_date', '')::date, (now() AT TIME ZONE 'America/Chihuahua')::date),
            nullif(v_payload->>'next_review_date', '')::date, v_request.top_mgmt_approver_name, v_request.top_mgmt_approver_role,
            v_request.top_mgmt_signature_url, v_request.top_mgmt_approved_at, v_request.requested_by::text)
        RETURNING id INTO v_document_id;
    END IF;
    INSERT INTO public.document_signatures(document_id, version, signer_name, signer_role, signature_url, signed_at, purpose)
    VALUES(v_document_id, v_version, v_request.top_mgmt_approver_name, v_request.top_mgmt_approver_role,
        v_request.top_mgmt_signature_url, v_request.top_mgmt_approved_at, 'approval');
    UPDATE public.document_requests SET status = 'published', resulting_document_id = v_document_id, published_at = now()
    WHERE id = p_request_id;
    INSERT INTO public.change_log(entity_type, entity_id, action, description, changed_by, source, metadata)
    VALUES('document_request', p_request_id::text, 'published', 'Requisición publicada conservando el código del documento',
        p_actor_name, 'app', jsonb_build_object('resulting_document_id', v_document_id, 'published_by', p_actor_id,
            'approved_by', v_request.top_mgmt_approver, 'version', v_version));
    RETURN jsonb_build_object('document_id', v_document_id, 'version', v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_document_request_atomic(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_document_request_atomic(uuid,uuid,text) TO service_role;
