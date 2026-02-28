-- ======================================
-- SUPPLIERS TABLE (mirrors clients)
-- ======================================
CREATE TABLE public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc TEXT NOT NULL,
    business_name TEXT NOT NULL,
    fiscal_regime TEXT,
    fiscal_zip_code TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    constancia_pdf_url TEXT,
    constancia_updated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on suppliers" ON public.suppliers FOR ALL USING (true) WITH CHECK (true);

-- ======================================
-- PURCHASE ORDERS
-- ======================================
CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TEXT AS $$
BEGIN
    RETURN 'PO' || LPAD(nextval('purchase_order_number_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number TEXT UNIQUE NOT NULL DEFAULT generate_po_number(),
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
    status TEXT NOT NULL DEFAULT 'Draft',
    subtotal NUMERIC NOT NULL DEFAULT 0,
    vat_total NUMERIC NOT NULL DEFAULT 0,
    total NUMERIC NOT NULL DEFAULT 0,
    supplier_quote_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    line_total NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on purchase_orders" ON public.purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on purchase_order_items" ON public.purchase_order_items FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for supplier quotes / PO files
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('purchase_files', 'purchase_files', true, 104857600)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read purchase_files" ON storage.objects FOR SELECT USING (bucket_id = 'purchase_files');
CREATE POLICY "Anon insert purchase_files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'purchase_files');
CREATE POLICY "Anon update purchase_files" ON storage.objects FOR UPDATE USING (bucket_id = 'purchase_files');
CREATE POLICY "Anon delete purchase_files" ON storage.objects FOR DELETE USING (bucket_id = 'purchase_files');
