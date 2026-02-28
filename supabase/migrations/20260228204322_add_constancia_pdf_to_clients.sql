-- Add columns for PDF Constancia
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS constancia_pdf_url TEXT,
ADD COLUMN IF NOT EXISTS constancia_updated_at TIMESTAMP WITH TIME ZONE;

-- Create Storage Bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('client_documents', 'client_documents', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
-- Allow anyone to read the PDFs (since the bucket is public anyway, this makes it explicit)
CREATE POLICY "Public Access" 
    ON storage.objects FOR SELECT 
    USING (bucket_id = 'client_documents');

-- Allow anon/authenticated users to insert files (development permissive policy)
CREATE POLICY "Allow Uploads" 
    ON storage.objects FOR INSERT 
    WITH CHECK (bucket_id = 'client_documents');

-- Allow anon/authenticated users to update their files
CREATE POLICY "Allow Updates" 
    ON storage.objects FOR UPDATE 
    USING (bucket_id = 'client_documents');
