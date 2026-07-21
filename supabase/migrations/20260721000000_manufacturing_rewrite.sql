-- =====================================================
-- MANUFACTURING REWRITE — 3 modules (Maquinado, Soldadura, Automatización)
-- Adds: WPS, pauses, operator signature, quality release,
--       delivery stages (Listo para embalaje / Entregados)
--       with GPS-tagged invoice/photo evidence.
-- =====================================================

-- -----------------------------------------------------
-- 1) Manufacturing modules
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.manufacturing_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,           -- 'maquinado' | 'soldadura' | 'automatizacion'
    name TEXT NOT NULL,                  -- 'Maquinado' | 'Soldadura' | 'Automatización'
    color TEXT NOT NULL,                 -- tailwind accent color
    icon TEXT NOT NULL,                  -- lucide icon name
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.manufacturing_modules (code, name, color, icon, sort_order) VALUES
    ('maquinado',      'Maquinado',       'orange',  'Cog',           1),
    ('soldadura',      'Soldadura',       'amber',   'Flame',         2),
    ('automatizacion', 'Automatización',  'cyan',    'Cpu',           3)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.manufacturing_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on manufacturing_modules" ON public.manufacturing_modules;
CREATE POLICY "Allow all on manufacturing_modules" ON public.manufacturing_modules FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 2) Welding Procedure Specifications (WPS) — Soldadura
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wps_procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,            -- 'WPS-001'
    name TEXT NOT NULL,
    joint_type TEXT,                      -- 'BW' (butt weld) | 'FW' (fillet weld)
    base_metal TEXT,                      -- e.g. 'A36', 'SA-516 Gr.70'
    thickness_range TEXT,                 -- e.g. '3-12 mm'
    filler_metal TEXT,                    -- e.g. 'E7018', 'ER70S-6'
    shielding_gas TEXT,                   -- e.g. '75% Ar / 25% CO2'
    position TEXT,                        -- '1G','2F','3G','4G','6G', etc.
    amperage TEXT,                        -- '120-160 A'
    voltage TEXT,                         -- '22-26 V'
    travel_speed TEXT,                    -- '20-30 cm/min'
    preheat_temp TEXT,                    -- '100°C min'
    pwht TEXT,                            -- Post Weld Heat Treatment
    notes TEXT,
    file_url TEXT,                        -- optional PDF reference
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.wps_procedures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on wps_procedures" ON public.wps_procedures;
CREATE POLICY "Allow all on wps_procedures" ON public.wps_procedures FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3) Work Orders — extend
-- -----------------------------------------------------
-- Make quotation_id nullable so we can create OTs without a quotation
ALTER TABLE public.work_orders ALTER COLUMN quotation_id DROP NOT NULL;

ALTER TABLE public.work_orders
    ADD COLUMN IF NOT EXISTS module_id UUID REFERENCES public.manufacturing_modules(id),
    ADD COLUMN IF NOT EXISTS client_name TEXT,                 -- when no quotation
    ADD COLUMN IF NOT EXISTS client_rfc TEXT,                  -- when no quotation
    ADD COLUMN IF NOT EXISTS work_title TEXT,                  -- e.g. 'Fabricación de brida'
    ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Normal',   -- 'Low' | 'Normal' | 'High' | 'Urgent'
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS operator_name TEXT,
    ADD COLUMN IF NOT EXISTS operator_signature_url TEXT,
    ADD COLUMN IF NOT EXISTS qc_rejected_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS qc_reject_reason TEXT,
    ADD COLUMN IF NOT EXISTS qc_released_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS qc_released_by TEXT;

-- -----------------------------------------------------
-- 4) WPS link to work orders
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_wps (
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    wps_id UUID NOT NULL REFERENCES public.wps_procedures(id) ON DELETE RESTRICT,
    PRIMARY KEY (work_order_id, wps_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.work_order_wps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on work_order_wps" ON public.work_order_wps;
CREATE POLICY "Allow all on work_order_wps" ON public.work_order_wps FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 5) Work order pauses (with reason)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_pauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,                -- 'Falta de materia prima' | 'Falta de documentación' | 'Falta de herramienta' | 'Mantenimiento' | 'Otro'
    custom_reason TEXT,                  -- free text when reason='Otro'
    paused_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resumed_at TIMESTAMP WITH TIME ZONE,
    paused_by TEXT,
    notes TEXT
);

ALTER TABLE public.work_order_pauses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on work_order_pauses" ON public.work_order_pauses;
CREATE POLICY "Allow all on work_order_pauses" ON public.work_order_pauses FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 6) Extend work_order_files with file_kind and file_type
-- -----------------------------------------------------
ALTER TABLE public.work_order_files
    ADD COLUMN IF NOT EXISTS file_kind TEXT DEFAULT 'reference',  -- 'drawing' | 'reference' | 'wps' | 'photo' | 'other'
    ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- -----------------------------------------------------
-- 7) Operator completion evidence (photos with GPS)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_completion_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Pieza terminada',
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    captured_by TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location_source TEXT  -- 'exif' | 'browser' | 'manual' | 'unknown'
);

ALTER TABLE public.work_order_completion_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on work_order_completion_photos" ON public.work_order_completion_photos;
CREATE POLICY "Allow all on work_order_completion_photos" ON public.work_order_completion_photos FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 8) Quality release records (one per review)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_qc_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,             -- 'released' | 'rejected'
    comments TEXT,
    inspector_name TEXT,
    signature_url TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    decided_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.work_order_qc_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on work_order_qc_records" ON public.work_order_qc_records;
CREATE POLICY "Allow all on work_order_qc_records" ON public.work_order_qc_records FOR ALL USING (true) WITH CHECK (true);

-- Quality evidence photos (for the quality release)
CREATE TABLE IF NOT EXISTS public.work_order_qc_evidence_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_record_id UUID REFERENCES public.work_order_qc_records(id) ON DELETE CASCADE,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'Evidencia QC',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.work_order_qc_evidence_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on work_order_qc_evidence_photos" ON public.work_order_qc_evidence_photos;
CREATE POLICY "Allow all on work_order_qc_evidence_photos" ON public.work_order_qc_evidence_photos FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 9) Deliveries — extend with stage + packaging + delivery
-- -----------------------------------------------------
-- stage: 'ready_for_packaging' | 'delivered'
ALTER TABLE public.deliveries
    ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'ready_for_packaging',
    ADD COLUMN IF NOT EXISTS packaged_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS packaged_by TEXT,
    ADD COLUMN IF NOT EXISTS packaging_signature_url TEXT,
    ADD COLUMN IF NOT EXISTS packaging_photo_url TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS delivered_by TEXT,
    ADD COLUMN IF NOT EXISTS delivery_signature_url TEXT,
    ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS delivery_location_source TEXT;

-- Delivery photos: invoice (CFDI received) + signature
CREATE TABLE IF NOT EXISTS public.delivery_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                  -- 'invoice' | 'signature' | 'packaging' | 'other'
    photo_url TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location_source TEXT,                -- 'exif' | 'browser' | 'manual' | 'unknown'
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    captured_by TEXT
);

ALTER TABLE public.delivery_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on delivery_photos" ON public.delivery_photos;
CREATE POLICY "Allow all on delivery_photos" ON public.delivery_photos FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 10) Storage bucket: signatures (PNG with transparent bg)
-- -----------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('signatures', 'signatures', true, 5242880)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read signatures" ON storage.objects
    FOR SELECT USING (bucket_id = 'signatures');
CREATE POLICY "Anon insert signatures" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'signatures');
CREATE POLICY "Anon update signatures" ON storage.objects
    FOR UPDATE USING (bucket_id = 'signatures');
CREATE POLICY "Anon delete signatures" ON storage.objects
    FOR DELETE USING (bucket_id = 'signatures');

-- -----------------------------------------------------
-- 11) Helpful indexes
-- -----------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_orders_module ON public.work_orders(module_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_stage ON public.deliveries(stage);
CREATE INDEX IF NOT EXISTS idx_pauses_wo ON public.work_order_pauses(work_order_id);

-- -----------------------------------------------------
-- 12) Seed: a few WPS procedures so the system isn't empty
-- -----------------------------------------------------
INSERT INTO public.wps_procedures (code, name, joint_type, base_metal, thickness_range, filler_metal, shielding_gas, position, amperage, voltage, travel_speed, preheat_temp, pwht, notes, is_active) VALUES
    ('WPS-001', 'Soldadura de filete en acero al carbono', 'FW', 'A36 / A-516', '3-12 mm', 'E7018', 'N/A (electrodo revestido)', '3F / 4F', '110-140 A', '22-25 V', '15-25 cm/min', '100°C min', 'No requerida', 'Soldadura SMAW para estructura secundaria.', true),
    ('WPS-002', 'Soldadura MIG en acero al carbono', 'BW', 'SA-516 Gr.70', '4-20 mm', 'ER70S-6', '75% Ar / 25% CO2', '1G / 2G / 3G', '180-220 A', '22-26 V', '25-40 cm/min', '100°C min', 'Opcional 595°C', 'GMAW para tanques y recipientes.', true),
    ('WPS-003', 'Soldadura TIG en acero inoxidable', 'BW', 'SA-240 304/316L', '2-8 mm', 'ER308L / ER316L', 'Argón 99.99%', '6G', '90-130 A', '12-16 V', '8-15 cm/min', 'N/A', 'No requerida', 'GTAW para acabado sanitario.', true),
    ('WPS-004', 'Soldadura de filete en aluminio', 'FW', 'AA6061-T6', '3-10 mm', 'ER4043', 'Argón 100%', '3F / 4F', '130-160 A', '18-22 V', '30-50 cm/min', 'N/A', 'No requerida', 'GMAW para estructura de aluminio.', true)
ON CONFLICT (code) DO NOTHING;
