-- ======================================
-- DELIVERIES TABLE
-- ======================================
CREATE TABLE public.deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_number TEXT UNIQUE NOT NULL,
    work_order_id UUID NOT NULL REFERENCES public.work_orders(id),
    observations TEXT,
    shipping_method TEXT,
    shipping_address TEXT,
    shipping_carrier TEXT,
    tracking_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on deliveries" ON public.deliveries FOR ALL USING (true) WITH CHECK (true);
