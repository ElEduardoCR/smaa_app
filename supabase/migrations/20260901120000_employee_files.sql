-- =====================================================
-- FASE 1 — EXPEDIENTE DEL EMPLEADO Y GENERACIÓN DOCUMENTAL
-- =====================================================
--   1) Catálogo de tipos de documento (qué debe tener un expediente)
--   2) Documentos del empleado (subidos y generados)
--   3) Plantillas de cartas, contratos y credenciales
--   4) Vista de completitud y vencimientos
--
-- Nota de diseño: aquí se guarda `file_path`, NO `file_url`. El bucket
-- employee_files es privado; la URL se firma en el momento desde el
-- servidor. Guardar una URL pública sería justo lo que queremos evitar,
-- porque este expediente lleva INE, CURP, actas y documentos médicos.
-- =====================================================


-- =====================================================
-- 1) TIPOS DE DOCUMENTO
-- =====================================================
CREATE TABLE IF NOT EXISTS public.employee_document_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'identidad',
        -- 'identidad' | 'fiscal' | 'laboral' | 'academico' | 'salud' | 'bancario' | 'otro'
    required BOOLEAN NOT NULL DEFAULT false,   -- cuenta para el % de expediente completo
    has_expiry BOOLEAN NOT NULL DEFAULT false, -- pide fecha de vencimiento y alerta
    expiry_alert_days INT NOT NULL DEFAULT 60, -- con cuánta anticipación avisar
    allows_multiple BOOLEAN NOT NULL DEFAULT false,  -- p.ej. constancias de curso
    description TEXT,
    sort_order INT NOT NULL DEFAULT 100,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_document_types_category_chk') THEN
        ALTER TABLE public.employee_document_types ADD CONSTRAINT employee_document_types_category_chk
            CHECK (category IN ('identidad','fiscal','laboral','academico','salud','bancario','otro'));
    END IF;
END $$;

ALTER TABLE public.employee_document_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on employee_document_types" ON public.employee_document_types;
CREATE POLICY "Allow all on employee_document_types" ON public.employee_document_types FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_document_types TO anon, authenticated, service_role;

INSERT INTO public.employee_document_types (code, name, category, required, has_expiry, allows_multiple, description, sort_order) VALUES
    ('acta_nacimiento',   'Acta de nacimiento',              'identidad', true,  false, false, NULL, 10),
    ('curp',              'CURP',                            'identidad', true,  false, false, NULL, 11),
    ('ine',               'Identificación oficial (INE)',    'identidad', true,  true,  false, 'Vence: hay que pedir la renovada', 12),
    ('comprobante_dom',   'Comprobante de domicilio',        'identidad', true,  true,  false, 'No mayor a 3 meses al momento de entregarlo', 13),
    ('foto',              'Fotografía',                      'identidad', false, false, false, 'Se usa para la credencial', 14),
    ('csf',               'Constancia de Situación Fiscal',   'fiscal',    true,  false, false, 'Se parsea para llenar RFC, régimen y CP fiscal', 20),
    ('nss_imss',          'Número de Seguridad Social',      'fiscal',    true,  false, false, NULL, 21),
    ('alta_imss',         'Aviso de alta ante el IMSS',      'fiscal',    true,  false, false, NULL, 22),
    ('solicitud_empleo',  'Solicitud de empleo',             'laboral',   true,  false, false, NULL, 30),
    ('contrato',          'Contrato de trabajo firmado',     'laboral',   true,  true,  true,  'Los de plazo determinado vencen', 31),
    ('cv',                'Currículum',                      'laboral',   false, false, false, NULL, 32),
    ('carta_recomendacion','Carta de recomendación',         'laboral',   false, false, true,  NULL, 33),
    ('nda',               'Convenio de confidencialidad',    'laboral',   false, false, false, NULL, 34),
    ('certificado_estudios','Certificado de estudios',       'academico', false, false, true,  NULL, 40),
    ('licencia_manejo',   'Licencia de conducir',            'academico', false, true,  false, NULL, 41),
    ('dc3',               'Constancia de competencias (DC-3)','academico', false, false, true,  'Capacitación STPS', 42),
    ('examen_medico',     'Examen médico de ingreso',        'salud',     false, true,  false, NULL, 50),
    ('datos_bancarios',   'Datos bancarios / carátula',      'bancario',  true,  false, false, 'Para la dispersión de nómina', 60),
    ('beneficiarios',     'Designación de beneficiarios',    'otro',      false, false, false, NULL, 70)
ON CONFLICT (code) DO NOTHING;


-- =====================================================
-- 2) PLANTILLAS DE CARTAS, CONTRATOS Y CREDENCIALES
-- =====================================================
-- Cartas, contratos y credenciales no son tres módulos: son tres salidas del
-- mismo motor. Lo que cambia es la plantilla y el tamaño de página.

CREATE TABLE IF NOT EXISTS public.document_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,                  -- 'letter' | 'contract' | 'badge'
    -- Cuerpo con marcadores {{empleado.nombre}}, {{empresa.razon_social}}, ...
    body_html TEXT NOT NULL,
    -- Tipo de documento del expediente en el que se archiva lo generado
    document_type_code TEXT REFERENCES public.employee_document_types(code),
    page_size TEXT NOT NULL DEFAULT 'letter',   -- 'letter' | 'a4' | 'badge_cr80'
    orientation TEXT NOT NULL DEFAULT 'portrait',
    requires_signature BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_by UUID REFERENCES public.employees(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_templates_kind_chk') THEN
        ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_kind_chk
            CHECK (kind IN ('letter','contract','badge'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_templates_page_chk') THEN
        ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_page_chk
            CHECK (page_size IN ('letter','a4','badge_cr80'));
    END IF;
END $$;

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on document_templates" ON public.document_templates;
CREATE POLICY "Allow all on document_templates" ON public.document_templates FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_templates TO anon, authenticated, service_role;

COMMENT ON TABLE public.document_templates IS
    'Plantillas de cartas, contratos y credenciales. Un solo motor de generación: lo que cambia es el cuerpo y el tamaño de página.';


-- =====================================================
-- 3) DOCUMENTOS DEL EMPLEADO
-- =====================================================
CREATE TABLE IF NOT EXISTS public.employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    type_code TEXT NOT NULL REFERENCES public.employee_document_types(code),
    -- Ruta dentro del bucket PRIVADO employee_files. No es una URL: se firma
    -- en el momento desde el servidor.
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT,
    file_size BIGINT,
    -- Vigencia
    issued_at DATE,
    expires_at DATE,
    -- Procedencia
    source TEXT NOT NULL DEFAULT 'upload',      -- 'upload' | 'generated'
    template_id UUID REFERENCES public.document_templates(id),
    template_version INT,
    -- Ciclo de vida: un documento nuevo del mismo tipo reemplaza al anterior
    -- sin borrarlo (para poder auditar qué se tenía y cuándo).
    superseded_by UUID REFERENCES public.employee_documents(id),
    superseded_at TIMESTAMP WITH TIME ZONE,
    -- Firma (contratos, convenios)
    signed_at TIMESTAMP WITH TIME ZONE,
    signature_url TEXT,
    notes TEXT,
    uploaded_by UUID REFERENCES public.employees(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_docs_employee
    ON public.employee_documents (employee_id, type_code);
CREATE INDEX IF NOT EXISTS idx_emp_docs_expiry
    ON public.employee_documents (expires_at)
    WHERE expires_at IS NOT NULL AND superseded_by IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_documents_source_chk') THEN
        ALTER TABLE public.employee_documents ADD CONSTRAINT employee_documents_source_chk
            CHECK (source IN ('upload','generated'));
    END IF;
END $$;

-- Un solo documento vigente por tipo, salvo los que permiten varios.
-- No se puede hacer con un índice parcial (Postgres no admite subconsultas en
-- el predicado), así que lo resuelve un trigger — que además da el
-- comportamiento correcto: subir un INE nuevo reemplaza al anterior en lugar
-- de rechazar la carga, y el viejo se conserva para auditoría.
CREATE OR REPLACE FUNCTION public.tg_supersede_previous_employee_document()
RETURNS TRIGGER AS $$
DECLARE
    v_allows_multiple BOOLEAN;
BEGIN
    IF NEW.superseded_by IS NOT NULL THEN
        RETURN NEW;   -- ya nace reemplazado (carga histórica)
    END IF;

    SELECT allows_multiple INTO v_allows_multiple
      FROM public.employee_document_types
     WHERE code = NEW.type_code;

    IF COALESCE(v_allows_multiple, false) THEN
        RETURN NEW;
    END IF;

    UPDATE public.employee_documents
       SET superseded_by = NEW.id,
           superseded_at = NOW()
     WHERE employee_id = NEW.employee_id
       AND type_code = NEW.type_code
       AND id <> NEW.id
       AND superseded_by IS NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supersede_previous_employee_document ON public.employee_documents;
CREATE TRIGGER trg_supersede_previous_employee_document
    AFTER INSERT ON public.employee_documents
    FOR EACH ROW EXECUTE FUNCTION public.tg_supersede_previous_employee_document();

ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on employee_documents" ON public.employee_documents;
CREATE POLICY "Allow all on employee_documents" ON public.employee_documents FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_documents TO anon, authenticated, service_role;

COMMENT ON COLUMN public.employee_documents.file_path IS
    'Ruta dentro del bucket privado employee_files. NO es una URL pública: se firma en el momento desde una server action que ya verificó permisos.';
COMMENT ON COLUMN public.employee_documents.superseded_by IS
    'Documento que lo reemplazó. Los reemplazados se conservan para poder auditar qué había en el expediente en una fecha dada.';


-- =====================================================
-- 4) VISTA DE COMPLETITUD DEL EXPEDIENTE
-- =====================================================
-- Lo valioso de un expediente no es guardar archivos: es saber qué falta y
-- qué está por vencer. Esta vista es la que alimenta esa pantalla.

CREATE OR REPLACE VIEW public.v_employee_document_status AS
WITH required_types AS (
    SELECT code, name, sort_order, expiry_alert_days
    FROM public.employee_document_types
    WHERE active AND required
),
current_docs AS (
    -- Un solo renglón por (empleado, tipo). Para los tipos que admiten varios
    -- documentos (contratos, constancias) se toma el más favorable: el que no
    -- vence gana, y si todos vencen, el de vigencia más lejana. Si no, un
    -- contrato viejo ya terminado marcaría el expediente como vencido aunque
    -- haya uno vigente.
    SELECT DISTINCT ON (employee_id, type_code)
           employee_id, type_code, expires_at
    FROM public.employee_documents
    WHERE superseded_by IS NULL
    ORDER BY employee_id, type_code,
             (expires_at IS NULL) DESC,
             expires_at DESC
)
SELECT
    e.id                                   AS employee_id,
    e.full_name,
    rt.code                                AS type_code,
    rt.name                                AS type_name,
    rt.sort_order,
    (cd.employee_id IS NOT NULL)           AS present,
    cd.expires_at,
    CASE
        WHEN cd.employee_id IS NULL THEN 'faltante'
        WHEN cd.expires_at IS NULL THEN 'vigente'
        WHEN cd.expires_at < CURRENT_DATE THEN 'vencido'
        WHEN cd.expires_at <= CURRENT_DATE + rt.expiry_alert_days THEN 'por_vencer'
        ELSE 'vigente'
    END                                    AS status
FROM public.employees e
CROSS JOIN required_types rt
LEFT JOIN current_docs cd
       ON cd.employee_id = e.id AND cd.type_code = rt.code;
-- Sin filtrar por is_active a propósito: la pantalla del empleado consulta por
-- employee_id y necesita el renglón aunque esté dado de baja (si no, saldría
-- 0/0 = 100%). Los reportes globales filtran ellos.

DO $$
BEGIN
    EXECUTE 'ALTER VIEW public.v_employee_document_status SET (security_invoker = true)';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'security_invoker no soportado en esta versión de Postgres; se omite.';
END $$;

GRANT SELECT ON public.v_employee_document_status TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_employee_document_status IS
    'Un renglón por empleado activo × tipo de documento obligatorio, con su estatus: faltante | vigente | por_vencer | vencido.';
