-- =====================================================
-- EMPLOYEES + PERMISSIONS + REQUISITIONS
-- Sistema de usuarios/empleados con login individual,
-- permisos granulares por módulo/sub-módulo, y flujo
-- de requisiciones → compras.
-- =====================================================

-- -----------------------------------------------------
-- 0) Helper: updated_at trigger (se define antes de las tablas)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- 1) Employees (usuarios del sistema)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,            -- formato: "scrypt$N$r$p$saltB64$hashB64"
    role TEXT NOT NULL DEFAULT 'operator',   -- 'master' | 'admin' | 'operator'
    position TEXT,                            -- "Operador de Soldadura", "Administrador", etc.
    photo_url TEXT,
    phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on employees" ON public.employees;
CREATE POLICY "Allow all on employees" ON public.employees FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 2) Employee permissions (granular por módulo + sub-módulo)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    module_code TEXT NOT NULL,               -- 'dashboard' | 'manufacturing' | 'sales' | 'purchases' | 'clients' | 'suppliers' | 'deliveries' | 'finance' | 'quality' | 'documents' | 'requisitions' | 'settings' | 'employees'
    sub_code TEXT,                           -- 'maquinado' | 'soldadura' | 'automatizacion' (sub-módulo, NULL = aplica al módulo completo)
    can_view BOOLEAN NOT NULL DEFAULT false,
    can_create BOOLEAN NOT NULL DEFAULT false,
    can_edit BOOLEAN NOT NULL DEFAULT false,
    can_delete BOOLEAN NOT NULL DEFAULT false,
    can_start BOOLEAN NOT NULL DEFAULT false,      -- iniciar proceso (manufacturing)
    can_pause BOOLEAN NOT NULL DEFAULT false,      -- pausar proceso
    can_complete BOOLEAN NOT NULL DEFAULT false,   -- terminar proceso
    can_request_supplies BOOLEAN NOT NULL DEFAULT false,  -- crear requisición
    can_purchase BOOLEAN NOT NULL DEFAULT false,   -- convertir requisición a compra
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, module_code, sub_code)
);

CREATE INDEX IF NOT EXISTS idx_employee_permissions_emp ON public.employee_permissions(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_permissions_module ON public.employee_permissions(module_code, sub_code);

ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on employee_permissions" ON public.employee_permissions;
CREATE POLICY "Allow all on employee_permissions" ON public.employee_permissions FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3) Requisitions (solicitudes de insumos de operadores)
-- -----------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.requisition_code_seq START 1;

CREATE OR REPLACE FUNCTION public.next_requisition_code()
RETURNS TEXT AS $$
DECLARE
    yr TEXT;
    n BIGINT;
BEGIN
    yr := to_char(NOW(), 'YYYY');
    n := nextval('public.requisition_code_seq');
    RETURN 'REQ-' || yr || '-' || lpad(n::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,                                -- REQ-2026-0001
    requested_by UUID NOT NULL REFERENCES public.employees(id),
    status TEXT NOT NULL DEFAULT 'pending',                    -- 'pending' | 'purchased' | 'cancelled'
    priority TEXT NOT NULL DEFAULT 'normal',                   -- 'low' | 'normal' | 'high' | 'urgent'
    needed_by DATE,                                            -- fecha en que lo necesita
    suggested_supplier_id UUID,                                -- FK condicional a suppliers (ver abajo)
    suggested_supplier_text TEXT,                              -- sugerencia libre del operador
    notes TEXT,
    purchased_at TIMESTAMP WITH TIME ZONE,
    purchased_by UUID REFERENCES public.employees(id),
    invoice_url TEXT,                                          -- factura adjunta al cerrar la compra
    invoice_photo_url TEXT,                                    -- foto opcional del material/factura
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- FKs condicionales (por si se aplica en un orden distinto o sin tablas previas)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'requisitions' AND constraint_name = 'requisitions_suggested_supplier_id_fkey') THEN
            ALTER TABLE public.requisitions
                ADD CONSTRAINT requisitions_suggested_supplier_id_fkey
                FOREIGN KEY (suggested_supplier_id) REFERENCES public.suppliers(id);
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_requisitions_status ON public.requisitions(status);
CREATE INDEX IF NOT EXISTS idx_requisitions_requested_by ON public.requisitions(requested_by);

ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on requisitions" ON public.requisitions;
CREATE POLICY "Allow all on requisitions" ON public.requisitions FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 4) Requisition items (lo que se solicita)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.requisition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES public.requisitions(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit TEXT DEFAULT 'pza',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requisition_items_req ON public.requisition_items(requisition_id);

ALTER TABLE public.requisition_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on requisition_items" ON public.requisition_items;
CREATE POLICY "Allow all on requisition_items" ON public.requisition_items FOR ALL USING (true) WITH CHECK (true);

-- Trigger de updated_at para requisitions (aquí ya existe la tabla)
DROP TRIGGER IF EXISTS trg_requisitions_updated ON public.requisitions;
CREATE TRIGGER trg_requisitions_updated BEFORE UPDATE ON public.requisitions
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- -----------------------------------------------------
-- 5) Requisition quotations (cotizaciones que el operador ya consiguió)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.requisition_quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES public.requisitions(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT,
    uploaded_by UUID REFERENCES public.employees(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.requisition_quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on requisition_quotations" ON public.requisition_quotations;
CREATE POLICY "Allow all on requisition_quotations" ON public.requisition_quotations FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 6) Link requisition to purchase_order (al convertir a compra)
-- -----------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_orders') THEN
        ALTER TABLE public.purchase_orders
            ADD COLUMN IF NOT EXISTS requisition_id UUID REFERENCES public.requisitions(id);
        CREATE INDEX IF NOT EXISTS idx_purchase_orders_requisition ON public.purchase_orders(requisition_id);
    END IF;
END $$;

-- -----------------------------------------------------
-- 7) updated_at triggers
--    (la función tg_set_updated_at se creó al inicio del archivo)
-- -----------------------------------------------------
DROP TRIGGER IF EXISTS trg_employees_updated ON public.employees;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- El trigger de requisitions se crea después de que la tabla exista (ver más abajo).

-- -----------------------------------------------------
-- 8) Storage buckets (solo si el schema storage existe — en Supabase sí)
-- -----------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit)
        VALUES
            ('employee_photos',    'employee_photos',    true, 5242880),
            ('requisition_files',  'requisition_files',  true, 20971520)
        ON CONFLICT (id) DO NOTHING;

        EXECUTE 'CREATE POLICY "Public read employee_photos"    ON storage.objects FOR SELECT USING (bucket_id = ''employee_photos'')';
        EXECUTE 'CREATE POLICY "Anon insert employee_photos"    ON storage.objects FOR INSERT WITH CHECK (bucket_id = ''employee_photos'')';
        EXECUTE 'CREATE POLICY "Anon update employee_photos"    ON storage.objects FOR UPDATE USING (bucket_id = ''employee_photos'')';
        EXECUTE 'CREATE POLICY "Anon delete employee_photos"    ON storage.objects FOR DELETE USING (bucket_id = ''employee_photos'')';

        EXECUTE 'CREATE POLICY "Public read requisition_files"  ON storage.objects FOR SELECT USING (bucket_id = ''requisition_files'')';
        EXECUTE 'CREATE POLICY "Anon insert requisition_files"  ON storage.objects FOR INSERT WITH CHECK (bucket_id = ''requisition_files'')';
        EXECUTE 'CREATE POLICY "Anon update requisition_files"  ON storage.objects FOR UPDATE USING (bucket_id = ''requisition_files'')';
        EXECUTE 'CREATE POLICY "Anon delete requisition_files"  ON storage.objects FOR DELETE USING (bucket_id = ''requisition_files'')';
    ELSE
        RAISE NOTICE 'Schema storage no existe (no es Supabase) — saltando creación de buckets y policies de storage.';
    END IF;
END $$;
