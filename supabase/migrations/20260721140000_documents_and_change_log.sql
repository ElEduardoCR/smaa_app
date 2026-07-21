-- =====================================================
-- DOCUMENT CONTROL (ISO 9001:2015) + CHANGE LOG
-- =====================================================

-- -----------------------------------------------------
-- 1) Document types (configurable prefixes)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,                  -- 'PRO' | 'REG' | 'FOR' | 'MAN' | 'POL' | 'INS' | 'PLA' | 'EXT'
    name TEXT NOT NULL,                          -- 'Procedimiento' | 'Registro' | 'Formato' | 'Manual' | etc.
    description TEXT,
    prefix TEXT NOT NULL,                        -- shown in folio: 'PRO-001'
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO public.document_types (code, name, description, prefix, sort_order) VALUES
    ('PRO', 'Procedimiento',   'Documento que describe cómo se realiza una actividad o proceso',     'PRO', 1),
    ('REG', 'Registro',        'Documento que presenta evidencia de actividades realizadas',          'REG', 2),
    ('FOR', 'Formato',         'Plantilla para captura de datos o llenado de información',            'FOR', 3),
    ('MAN', 'Manual',          'Documento amplio que describe un sistema, equipo o proceso completo', 'MAN', 4),
    ('POL', 'Política',        'Intención y dirección de la organización, formalmente expresada',     'POL', 5),
    ('INS', 'Instrucción',     'Documento que describe paso a paso una actividad específica',          'INS', 6),
    ('PLA', 'Plan',            'Documento que establece acciones y recursos para alcanzar objetivos',   'PLA', 7),
    ('EXT', 'Externo',         'Documento controlado de origen externo (normas, regulaciones)',         'EXT', 8)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on document_types" ON public.document_types;
CREATE POLICY "Allow all on document_types" ON public.document_types FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 2) Documents (the ISO 9001:2015 controlled documents)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folio TEXT UNIQUE NOT NULL,                  -- 'PRO-001' auto-generated
    type_id UUID NOT NULL REFERENCES public.document_types(id),
    title TEXT NOT NULL,
    -- ISO 9001:2015 required sections
    objective TEXT,                              -- Objetivo
    scope TEXT,                                  -- Alcance
    definitions TEXT,                            -- Definiciones / Glosario
    responsibilities TEXT,                       -- Responsabilidades
    content TEXT NOT NULL,                       -- Desarrollo / Procedimiento
    document_references TEXT,                    -- Referencias documentales
    records TEXT,                                -- Registros asociados
    keywords TEXT,                               -- Palabras clave para búsqueda
    -- ISO 9001:2015 clause 7.5 control
    version TEXT NOT NULL DEFAULT '1.0',
    revision INT NOT NULL DEFAULT 1,              -- número de revisión incremental
    status TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'in_review' | 'approved' | 'obsolete' | 'pending_obsolete'
    effective_date DATE,
    next_review_date DATE,
    obsoleted_at TIMESTAMP WITH TIME ZONE,
    obsoleted_reason TEXT,
    -- Approval signature (required for "approved" status)
    approval_name TEXT,
    approval_role TEXT,                          -- 'Director' | 'Gerente Calidad' | etc.
    approval_signature_url TEXT,
    approval_signed_at TIMESTAMP WITH TIME ZONE,
    -- Audit
    created_by TEXT,                             -- free-text name (no auth in this app)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_type ON public.documents(type_id);
CREATE INDEX IF NOT EXISTS idx_documents_folio ON public.documents(folio);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on documents" ON public.documents;
CREATE POLICY "Allow all on documents" ON public.documents FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3) Document versions (snapshot of each version)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    version TEXT NOT NULL,                       -- '1.0', '1.1', '2.0'
    revision INT NOT NULL,
    -- Snapshot of content at this version
    title TEXT NOT NULL,
    objective TEXT,
    scope TEXT,
    definitions TEXT,
    responsibilities TEXT,
    content TEXT NOT NULL,
    document_references TEXT,
    records TEXT,
    keywords TEXT,
    -- Metadata of the change
    change_summary TEXT,                         -- 'Corregido paso 3', 'Actualizadas referencias'
    changed_by TEXT,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    signature_url TEXT                           -- optional signature on the change
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON public.document_versions(document_id);

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on document_versions" ON public.document_versions;
CREATE POLICY "Allow all on document_versions" ON public.document_versions FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 4) Document signatures (each signature, multiple allowed)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    signer_role TEXT,
    signature_url TEXT NOT NULL,
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    purpose TEXT DEFAULT 'approval'              -- 'approval' | 'review' | 'release' | 'knowledge'
);

ALTER TABLE public.document_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on document_signatures" ON public.document_signatures;
CREATE POLICY "Allow all on document_signatures" ON public.document_signatures FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 5) Function: generate next folio for a document type
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_document_folio(type_prefix TEXT)
RETURNS TEXT AS $$
DECLARE
    v_max INT;
    v_next TEXT;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(folio FROM '[0-9]+$') AS INT)), 0)
    INTO v_max
    FROM public.documents
    WHERE folio LIKE type_prefix || '-%'
      AND folio ~ ('^' || type_prefix || '-[0-9]+$');
    v_next := type_prefix || '-' || LPAD((v_max + 1)::TEXT, 3, '0');
    RETURN v_next;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- 6) Function: bump version (1.0 -> 1.1 minor, 1.0 -> 2.0 major)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_version(current_version TEXT, kind TEXT)
RETURNS TEXT AS $$
DECLARE
    parts TEXT[];
    major INT;
    minor INT;
BEGIN
    parts := string_to_array(current_version, '.');
    IF array_length(parts, 1) < 2 THEN
        major := COALESCE(parts[1]::INT, 1);
        minor := 0;
    ELSE
        major := parts[1]::INT;
        minor := parts[2]::INT;
    END IF;
    IF kind = 'major' THEN
        major := major + 1;
        minor := 0;
    ELSE
        minor := minor + 1;
    END IF;
    RETURN major || '.' || minor;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CHANGE LOG (audit trail)
-- =====================================================

-- -----------------------------------------------------
-- 7) Generic change_log table
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,                   -- 'work_order' | 'employee' | 'payroll' | 'declaration' | 'document' | etc.
    entity_id TEXT,                              -- UUID as text (we don't FK so it survives deletes)
    action TEXT NOT NULL,                        -- 'create' | 'update' | 'delete' | 'status_change' | 'sign' | 'attach' | 'comment'
    field_name TEXT,                             -- which field changed
    old_value TEXT,
    new_value TEXT,
    description TEXT,                            -- human readable summary
    changed_by TEXT,                             -- name / 'system' / 'github'
    source TEXT NOT NULL DEFAULT 'app',         -- 'app' | 'github' | 'manual' | 'trigger' | 'system'
    -- GitHub-specific
    commit_sha TEXT,
    commit_message TEXT,
    commit_author TEXT,
    commit_url TEXT,
    commit_date TIMESTAMP WITH TIME ZONE,
    -- App-specific
    metadata JSONB,                              -- any extra context
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_log_entity ON public.change_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_change_log_changed_at ON public.change_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_source ON public.change_log(source);
CREATE INDEX IF NOT EXISTS idx_change_log_action ON public.change_log(action);

ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on change_log" ON public.change_log;
CREATE POLICY "Allow all on change_log" ON public.change_log FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 8) Generic trigger function
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_log_change()
RETURNS TRIGGER AS $$
DECLARE
    v_entity_type TEXT;
    v_entity_id TEXT;
    v_action TEXT;
    v_field TEXT;
    v_old TEXT;
    v_new TEXT;
    v_changed_by TEXT;
    v_description TEXT;
    v_excluded_fields TEXT[] := ARRAY['updated_at', 'created_at', 'id'];
    v_key TEXT;
    v_new_json JSONB;
    v_old_json JSONB;
BEGIN
    -- Determine entity type and id
    v_entity_type := TG_ARGV[0];
    IF TG_OP = 'DELETE' THEN
        v_entity_id := OLD.id::TEXT;
    ELSE
        v_entity_id := NEW.id::TEXT;
    END IF;

    -- For UPDATE: log each changed field
    IF TG_OP = 'UPDATE' THEN
        v_action := 'update';
        -- Try to extract common 'changed_by' field
        BEGIN v_changed_by := NEW.changed_by; EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;
        IF v_changed_by IS NULL THEN
            BEGIN v_changed_by := NEW.created_by; EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;
        END IF;
        IF v_changed_by IS NULL THEN
            BEGIN v_changed_by := NEW.updated_by; EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;
        END IF;
        IF v_changed_by IS NULL THEN
            v_changed_by := current_setting('app.current_user', true);
        END IF;
        IF v_changed_by IS NULL THEN v_changed_by := 'system'; END IF;

        v_new_json := to_jsonb(NEW);
        v_old_json := to_jsonb(OLD);

        FOR v_key IN SELECT jsonb_object_keys(v_new_json)
        LOOP
            IF v_key = ANY(v_excluded_fields) THEN CONTINUE; END IF;
            v_new := v_new_json ->> v_key;
            v_old := v_old_json ->> v_key;
            IF v_old IS DISTINCT FROM v_new THEN
                -- Detect status changes specifically
                IF v_key = 'status' THEN
                    v_action := 'status_change';
                    v_description := 'Estado: ' || COALESCE(v_old, '?') || ' → ' || COALESCE(v_new, '?');
                ELSE
                    v_description := v_key || ': ' || COALESCE(SUBSTRING(v_old, 1, 200), '?') || ' → ' || COALESCE(SUBSTRING(v_new, 1, 200), '?');
                END IF;
                INSERT INTO public.change_log (entity_type, entity_id, action, field_name, old_value, new_value, description, changed_by, source)
                VALUES (v_entity_type, v_entity_id, v_action, v_key, SUBSTRING(v_old, 1, 1000), SUBSTRING(v_new, 1, 1000), v_description, v_changed_by, 'trigger');
            END IF;
        END LOOP;
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        BEGIN v_changed_by := NEW.created_by; EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;
        IF v_changed_by IS NULL THEN
            v_changed_by := current_setting('app.current_user', true);
        END IF;
        IF v_changed_by IS NULL THEN v_changed_by := 'system'; END IF;
        INSERT INTO public.change_log (entity_type, entity_id, action, description, changed_by, source, new_value)
        VALUES (v_entity_type, v_entity_id, 'create', 'Creado', v_changed_by, 'trigger', NEW.id::TEXT);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.change_log (entity_type, entity_id, action, description, changed_by, source, old_value)
        VALUES (v_entity_type, v_entity_id, 'delete', 'Eliminado', 'system', 'trigger', OLD.id::TEXT);
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- 9) Apply trigger to key tables
-- -----------------------------------------------------
DROP TRIGGER IF EXISTS trg_log_documents ON public.documents;
CREATE TRIGGER trg_log_documents AFTER INSERT OR UPDATE OR DELETE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('document');

DROP TRIGGER IF EXISTS trg_log_document_versions ON public.document_versions;
CREATE TRIGGER trg_log_document_versions AFTER INSERT OR UPDATE OR DELETE ON public.document_versions
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('document_version');

DROP TRIGGER IF EXISTS trg_log_employees ON public.employees;
CREATE TRIGGER trg_log_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('employee');

DROP TRIGGER IF EXISTS trg_log_payroll_periods ON public.payroll_periods;
CREATE TRIGGER trg_log_payroll_periods AFTER INSERT OR UPDATE OR DELETE ON public.payroll_periods
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('payroll_period');

DROP TRIGGER IF EXISTS trg_log_payroll_receipts ON public.payroll_receipts;
CREATE TRIGGER trg_log_payroll_receipts AFTER INSERT OR UPDATE OR DELETE ON public.payroll_receipts
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('payroll_receipt');

DROP TRIGGER IF EXISTS trg_log_declarations ON public.monthly_declarations;
CREATE TRIGGER trg_log_declarations AFTER INSERT OR UPDATE OR DELETE ON public.monthly_declarations
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('declaration');

DROP TRIGGER IF EXISTS trg_log_work_orders ON public.work_orders;
CREATE TRIGGER trg_log_work_orders AFTER INSERT OR UPDATE OR DELETE ON public.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('work_order');

DROP TRIGGER IF EXISTS trg_log_manufacturing_modules ON public.manufacturing_modules;
CREATE TRIGGER trg_log_manufacturing_modules AFTER INSERT OR UPDATE OR DELETE ON public.manufacturing_modules
    FOR EACH ROW EXECUTE FUNCTION public.tg_log_change('manufacturing_module');

-- =====================================================
-- GITHUB SYNC
-- =====================================================

-- -----------------------------------------------------
-- 10) GitHub sync settings + last sync state
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.github_sync_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT,                                  -- PAT (optional for public repos)
    repo_owner TEXT NOT NULL DEFAULT 'ElEduardoCR',
    repo_name TEXT NOT NULL DEFAULT 'smaa_app',
    branch TEXT NOT NULL DEFAULT 'main',
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_sync_count INT DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.github_sync_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on github_sync_settings" ON public.github_sync_settings;
CREATE POLICY "Allow all on github_sync_settings" ON public.github_sync_settings FOR ALL USING (true) WITH CHECK (true);

-- Seed default settings row
INSERT INTO public.github_sync_settings (token, repo_owner, repo_name, branch)
VALUES (NULL, 'ElEduardoCR', 'smaa_app', 'main')
ON CONFLICT DO NOTHING;
