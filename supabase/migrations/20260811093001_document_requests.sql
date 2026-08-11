-- =====================================================
-- document_requests: workflow de requisición de documentos.
--
-- Requisición de documento NUEVO:
--   Cualquier empleado con permiso 'documents:create' puede crear una
--   requisición. El controlador de documentos la revisa y:
--     - Aprueba → pasa a pendiente de Alta Dirección.
--     - Rechaza (con notas) → el solicitante la modifica y reenvía.
--   Alta Dirección revisa y:
--     - Aprueba y firma → se publica como nuevo documento.
--     - Rechaza (con notas) → el solicitante puede modificar y reenviar.
--
-- Requisición de CAMBIO de documento existente:
--   Mismo flujo, pero el resultado es una nueva versión del documento
--   referenciado en `target_document_id`. Al publicarse, la versión
--   anterior se marca como `obsolete` con motivo "Reemplazado por vX.Y".
--
-- Evidencias: cada cambio de estado queda en `change_log` (entidad
-- 'document_request'), con metadata de quién aprobó/rechazó y notas.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.document_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tipo de requisición
    type TEXT NOT NULL CHECK (type IN ('new', 'change')),

    -- Solo para type='change': el documento que se quiere modificar
    target_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,

    -- Datos de la propuesta
    title TEXT NOT NULL,                         -- título propuesto
    change_summary TEXT,                         -- resumen del cambio (para type='change')
    reason TEXT NOT NULL,                        -- por qué se necesita (justificación)

    -- Payload completo del documento propuesto.
    -- Para type='new': contiene todos los campos del doc (folio se genera al publicar).
    -- Para type='change': contiene los campos a actualizar.
    -- Estructura (jsonb) — ver type definitions en /src/app/actions/documentRequests.ts
    payload JSONB NOT NULL,

    -- Estado del workflow
    status TEXT NOT NULL DEFAULT 'pending_doc_control' CHECK (status IN (
        'pending_doc_control',     -- recién creada, esperando al controlador
        'rejected_by_doc_control', -- rechazada por el controlador (con notas)
        'pending_top_mgmt',        -- aprobada por controlador, esperando Alta Dirección
        'rejected',                -- rechazada por Alta Dirección (definitivo o para reenviar)
        'approved',                -- aprobada por Alta Dirección, pendiente de publicar
        'published',               -- ya se publicó el documento
        'cancelled'                -- el solicitante la canceló
    )),

    -- Solicitante
    requested_by UUID NOT NULL REFERENCES public.employees(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Revisión del Controlador de Documentos
    doc_control_reviewer UUID REFERENCES public.employees(id),
    doc_control_reviewed_at TIMESTAMPTZ,
    doc_control_notes TEXT,

    -- Aprobación de Alta Dirección
    top_mgmt_approver UUID REFERENCES public.employees(id),
    top_mgmt_approved_at TIMESTAMPTZ,
    top_mgmt_notes TEXT,

    -- Para auditoría: cuántas veces fue rechazada y vueltas a enviar
    revision_count INT NOT NULL DEFAULT 0,

    -- Resultado (cuando ya se publicó)
    resulting_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,

    -- Auditoría general
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_doc_requests_status
    ON public.document_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_requests_requester
    ON public.document_requests (requested_by, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_requests_target
    ON public.document_requests (target_document_id)
    WHERE target_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doc_requests_doc_control_reviewer
    ON public.document_requests (doc_control_reviewer)
    WHERE doc_control_reviewer IS NOT NULL;

-- Trigger para updated_at
DROP TRIGGER IF EXISTS trg_doc_requests_updated_at ON public.document_requests;
CREATE TRIGGER trg_doc_requests_updated_at
    BEFORE UPDATE ON public.document_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_set_updated_at();

-- RLS: el sistema actual usa 'Allow full access for development' en otras
-- tablas, replicamos el mismo patrón aquí. Si después se quiere RLS
-- estricto, se ajusta.
ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'document_requests' AND policyname = 'Allow full access for development'
    ) THEN
        CREATE POLICY "Allow full access for development"
            ON public.document_requests
            FOR ALL
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.document_requests IS
    'Requisiciones de documento nuevo o cambio. Workflow: solicitante → controlador de documentos → alta dirección → publicación. Evidencias en change_log.';
