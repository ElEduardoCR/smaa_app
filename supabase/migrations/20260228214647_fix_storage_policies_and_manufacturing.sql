-- FIX: Make storage policies use anon role (no auth required for dev)
-- Drop old restrictive policies
DROP POLICY IF EXISTS "Allow authenticated uploads public_assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates public_assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletions public_assets" ON storage.objects;

-- Recreate permissive policies (anyone can upload/update/delete in public_assets)
CREATE POLICY "Anon uploads public_assets" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'public_assets');

CREATE POLICY "Anon updates public_assets" ON storage.objects
    FOR UPDATE USING (bucket_id = 'public_assets');

CREATE POLICY "Anon deletes public_assets" ON storage.objects
    FOR DELETE USING (bucket_id = 'public_assets');

-- ======================================
-- MANUFACTURING MODULE SCHEMA
-- ======================================

-- Work Orders Table
CREATE TABLE public.work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT UNIQUE NOT NULL,
    quotation_id UUID NOT NULL REFERENCES public.quotations(id),
    status TEXT NOT NULL DEFAULT 'Open',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Operations / Routing Table
CREATE TABLE public.work_order_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    sequence INT NOT NULL DEFAULT 1,
    operation_type TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- File Attachments Table
CREATE TABLE public.work_order_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT,
    uploaded_by TEXT DEFAULT 'company',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_files ENABLE ROW LEVEL SECURITY;

-- Permissive dev policies
CREATE POLICY "Allow all on work_orders" ON public.work_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on work_order_operations" ON public.work_order_operations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on work_order_files" ON public.work_order_files FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for work order files (100MB limit set in application)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('work_order_files', 'work_order_files', true, 104857600)
ON CONFLICT (id) DO NOTHING;

-- Storage bucket policies
CREATE POLICY "Public read work_order_files" ON storage.objects
    FOR SELECT USING (bucket_id = 'work_order_files');

CREATE POLICY "Anon insert work_order_files" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'work_order_files');

CREATE POLICY "Anon update work_order_files" ON storage.objects
    FOR UPDATE USING (bucket_id = 'work_order_files');

CREATE POLICY "Anon delete work_order_files" ON storage.objects
    FOR DELETE USING (bucket_id = 'work_order_files');
