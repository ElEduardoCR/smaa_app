-- =====================================================
-- Fix: el trigger de ar_payment_allocations debe actualizar ar_invoices,
-- no intentar setear NEW.paid_amount (NEW es la allocation, no la invoice).
-- =====================================================

DROP TRIGGER IF EXISTS trg_ar_recalc_invoice ON public.ar_payment_allocations;
DROP FUNCTION IF EXISTS public.ar_recalc_invoice();

CREATE OR REPLACE FUNCTION public.ar_recalc_invoice()
RETURNS TRIGGER AS $$
DECLARE
    inv_id UUID;
    inv_net NUMERIC(14,2);
    total_paid NUMERIC(14,2);
    new_status TEXT;
BEGIN
    -- Detectar el invoice_id según la operación (INSERT/UPDATE/DELETE)
    IF TG_OP = 'DELETE' THEN
        inv_id := OLD.invoice_id;
    ELSE
        inv_id := NEW.invoice_id;
    END IF;

    -- Obtener el monto neto actual de la invoice
    SELECT net_amount INTO inv_net FROM public.ar_invoices WHERE id = inv_id;
    IF inv_net IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Sumar todas las allocations vigentes
    SELECT COALESCE(SUM(amount_applied), 0)
      INTO total_paid
      FROM public.ar_payment_allocations
     WHERE invoice_id = inv_id;

    -- Determinar nuevo status (no tocar si está cancelada)
    IF (SELECT status FROM public.ar_invoices WHERE id = inv_id) = 'cancelled' THEN
        new_status := 'cancelled';
    ELSIF total_paid <= 0 THEN
        new_status := 'pending';
    ELSIF total_paid >= inv_net THEN
        new_status := 'paid';
    ELSE
        new_status := 'partial';
    END IF;

    -- Actualizar la invoice
    UPDATE public.ar_invoices
       SET paid_amount = total_paid,
           status = new_status,
           updated_at = NOW()
     WHERE id = inv_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ar_recalc_invoice
    AFTER INSERT OR UPDATE OR DELETE ON public.ar_payment_allocations
    FOR EACH ROW EXECUTE FUNCTION public.ar_recalc_invoice();
