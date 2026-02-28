-- Create company_settings table
CREATE TABLE public.company_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default row
INSERT INTO public.company_settings (company_name, email, phone, address)
VALUES ('VOXA', 'contacto@voxa.com', '555-000-0000', 'Ciudad de México, México');

-- Enable RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- Permissive dev policies
CREATE POLICY "Allow all operations for company_settings" ON public.company_settings
    FOR ALL USING (true) WITH CHECK (true);

-- Create public_assets bucket for Logos and public branding material
INSERT INTO storage.buckets (id, name, public) 
VALUES ('public_assets', 'public_assets', true)
ON CONFLICT (id) DO NOTHING;

-- Bucket Security Policies for public_assets
CREATE POLICY "Public Access public_assets" ON storage.objects
    FOR SELECT USING (bucket_id = 'public_assets');

CREATE POLICY "Allow authenticated uploads public_assets" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'public_assets');

CREATE POLICY "Allow authenticated updates public_assets" ON storage.objects
    FOR UPDATE USING (bucket_id = 'public_assets');

CREATE POLICY "Allow authenticated deletions public_assets" ON storage.objects
    FOR DELETE USING (bucket_id = 'public_assets');
