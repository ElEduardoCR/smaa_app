-- Sequence for Voxa Quotation Numbers
CREATE SEQUENCE IF NOT EXISTS quotation_number_seq START 1;

-- Function to perfectly format quotation numbers like 'VOXA00001'
CREATE OR REPLACE FUNCTION generate_quotation_number()
RETURNS TEXT AS $$
BEGIN
  RETURN 'VOXA' || LPAD(nextval('quotation_number_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Quotations Table
CREATE TABLE public.quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_number TEXT UNIQUE NOT NULL DEFAULT generate_quotation_number(),
    client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Approved', 'Rejected')),
    subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    vat_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quotation Items Table
CREATE TABLE public.quotation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00
);

-- RLS Setup
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;

-- Permissive Development Policies
CREATE POLICY "Allow all operations for quotations" ON public.quotations
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations for quotation_items" ON public.quotation_items
    FOR ALL USING (true) WITH CHECK (true);
