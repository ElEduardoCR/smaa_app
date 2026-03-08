-- Add invoice_url to purchase_orders
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS invoice_url TEXT;

-- Status can now also be 'Received'
-- Currently status is just TEXT with no check constraint, but we will use 'Received' in the app.
