-- Nombre comercial del proveedor, separado de su razón social fiscal.
ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS name TEXT;

COMMENT ON COLUMN public.suppliers.name IS
    'Nombre comercial o nombre por el que se conoce al proveedor; business_name conserva la razón social fiscal.';

-- Fecha calendario comprometida en la cotización. delivery_time se conserva
-- para notas flexibles como "5 días hábiles".
ALTER TABLE public.quotations
    ADD COLUMN IF NOT EXISTS delivery_date DATE;

COMMENT ON COLUMN public.quotations.delivery_date IS
    'Fecha de entrega comprometida utilizada por el calendario de Entregas.';

CREATE INDEX IF NOT EXISTS idx_quotations_delivery_date
    ON public.quotations(delivery_date)
    WHERE delivery_date IS NOT NULL;
