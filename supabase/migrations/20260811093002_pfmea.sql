-- =====================================================
-- PFMEA / AMEF — Process Failure Mode and Effects Analysis.
--
-- Tres escalas (1 a 5):
--   - severity:    1=bajo (impacto menor), 5=alto (impacto crítico / cliente).
--   - occurrence:  1=ocurre una vez al mes, 5=varias veces por turno.
--   - detection:   1=se detecta rápido (fácil), 5=difícil de detectar.
--
-- RPN (Risk Priority Number) = severity × occurrence × detection.
-- Rango: 1 (riesgo despreciable) a 125 (riesgo crítico).
--
-- Definiciones de las escalas se guardan en `pfmea_scales` para
-- que sean editables desde la UI (sin redeploy).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.pfmea_risks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificación del riesgo
    process TEXT NOT NULL,                 -- proceso / etapa donde ocurre
    failure_mode TEXT NOT NULL,            -- modo de falla potencial
    effect TEXT NOT NULL,                  -- efecto en el cliente / proceso siguiente
    cause TEXT NOT NULL,                   -- causa potencial

    -- Escalas (1-5). RPN se calcula automáticamente.
    severity INT NOT NULL CHECK (severity BETWEEN 1 AND 5),
    occurrence INT NOT NULL CHECK (occurrence BETWEEN 1 AND 5),
    detection INT NOT NULL CHECK (detection BETWEEN 1 AND 5),
    rpn INT GENERATED ALWAYS AS (severity * occurrence * detection) STORED,

    -- Controles y plan de acción
    current_controls TEXT,                  -- controles actuales (si los hay)
    recommended_actions TEXT,              -- acciones recomendadas para reducir el riesgo
    responsible TEXT,                      -- responsable de ejecutar las acciones
    target_date DATE,                      -- fecha objetivo de cierre

    -- Estado
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open',           -- recién identificado
        'in_progress',    -- trabajando en acciones
        'closed'          -- riesgo mitigado o aceptado formalmente
    )),
    notes TEXT,

    -- Auditoría
    created_by UUID REFERENCES public.employees(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_pfmea_risks_rpn
    ON public.pfmea_risks (rpn DESC, status)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pfmea_risks_status
    ON public.pfmea_risks (status, updated_at DESC)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pfmea_risks_process
    ON public.pfmea_risks (process)
    WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_pfmea_risks_updated_at ON public.pfmea_risks;
CREATE TRIGGER trg_pfmea_risks_updated_at
    BEFORE UPDATE ON public.pfmea_risks
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.pfmea_risks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'pfmea_risks' AND policyname = 'Allow full access for development'
    ) THEN
        CREATE POLICY "Allow full access for development"
            ON public.pfmea_risks
            FOR ALL
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.pfmea_risks IS
    'PFMEA / AMEF: riesgos por proceso. RPN = severity × occurrence × detection.';


-- =====================================================
-- Definiciones de las 3 escalas (5 niveles cada una).
-- Editables desde la UI si se requiere ajustar la semántica.
-- =====================================================
CREATE TABLE IF NOT EXISTS public.pfmea_scales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scale_type TEXT NOT NULL CHECK (scale_type IN ('severity', 'occurrence', 'detection')),
    level INT NOT NULL CHECK (level BETWEEN 1 AND 5),
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    UNIQUE (scale_type, level)
);

CREATE INDEX IF NOT EXISTS idx_pfmea_scales_type_level
    ON public.pfmea_scales (scale_type, level);

ALTER TABLE public.pfmea_scales ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'pfmea_scales' AND policyname = 'Allow full access for development'
    ) THEN
        CREATE POLICY "Allow full access for development"
            ON public.pfmea_scales
            FOR ALL
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMENT ON TABLE public.pfmea_scales IS
    'Definición de los 5 niveles de cada escala (severity, occurrence, detection).';
