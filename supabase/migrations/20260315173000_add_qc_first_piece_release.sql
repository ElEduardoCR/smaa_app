-- ======================================
-- QC FIRST PIECE RELEASE
-- ======================================

-- Add QC approval fields to work_orders
ALTER TABLE public.work_orders
    ADD COLUMN IF NOT EXISTS qc_approved BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS qc_approved_at TIMESTAMP WITH TIME ZONE;

-- Create QC photos table
CREATE TABLE IF NOT EXISTS public.work_order_qc_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    photo_label TEXT NOT NULL DEFAULT 'Primera Pieza',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.work_order_qc_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on work_order_qc_photos" ON public.work_order_qc_photos FOR ALL USING (true) WITH CHECK (true);
