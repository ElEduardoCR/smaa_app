-- Add CFDI 4.0 columns to existing clients table safely
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS rfc VARCHAR(13) UNIQUE,
ADD COLUMN IF NOT EXISTS business_name TEXT,
ADD COLUMN IF NOT EXISTS fiscal_regime VARCHAR(3),
ADD COLUMN IF NOT EXISTS fiscal_zip_code VARCHAR(5),
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS address TEXT;

-- Enable RLS and add policy just in case it wasn't there
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'clients' 
    AND policyname = 'Allow full access for development'
  ) THEN
    CREATE POLICY "Allow full access for development" ON public.clients
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
