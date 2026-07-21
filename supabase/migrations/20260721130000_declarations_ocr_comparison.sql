-- =====================================================
-- DECLARATIONS — OCR/EXTRACTION + COMPARISON
-- =====================================================

-- -----------------------------------------------------
-- 1) New columns on monthly_declarations for extracted SAT data
-- -----------------------------------------------------
ALTER TABLE public.monthly_declarations
    ADD COLUMN IF NOT EXISTS extracted_data JSONB,
    ADD COLUMN IF NOT EXISTS sat_folio TEXT,
    ADD COLUMN IF NOT EXISTS sat_iva_a_pagar NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_iva_a_favor NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_isr_a_pagar NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_iva_cobrado NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_iva_acreditable NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_ingresos_nominales NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_deducciones_autorizadas NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_filing_date TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS sat_due_date DATE,
    ADD COLUMN IF NOT EXISTS sat_cantidad_a_pagar NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sat_linea_captura TEXT,
    ADD COLUMN IF NOT EXISTS sat_tipo_declaracion TEXT,
    ADD COLUMN IF NOT EXISTS sat_periodo TEXT,
    ADD COLUMN IF NOT EXISTS sat_raw_text TEXT,
    ADD COLUMN IF NOT EXISTS comparison_diff_iva NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS comparison_diff_isr NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS comparison_diff_pct NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS comparison_notes TEXT;

-- -----------------------------------------------------
-- 2) monthly_iva_summary — data warehouse table for fast lookups
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monthly_iva_summary (
    period TEXT PRIMARY KEY,            -- 'YYYY-MM'
    total_ventas_gravadas NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_16 NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_8 NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_0 NUMERIC(14,2) DEFAULT 0,
    iva_cobrado_total NUMERIC(14,2) DEFAULT 0,
    total_compras_gravadas NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_16 NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_8 NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_0 NUMERIC(14,2) DEFAULT 0,
    iva_acreditable_total NUMERIC(14,2) DEFAULT 0,
    invoice_count_sales INT DEFAULT 0,
    invoice_count_purchases INT DEFAULT 0,
    last_sale_at TIMESTAMP WITH TIME ZONE,
    last_purchase_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.monthly_iva_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on monthly_iva_summary" ON public.monthly_iva_summary;
CREATE POLICY "Allow all on monthly_iva_summary" ON public.monthly_iva_summary FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3) Function: recompute one period (sales + purchases)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_monthly_iva_summary(target_period TEXT)
RETURNS void AS $$
DECLARE
    v_sales_16 NUMERIC := 0;
    v_sales_8 NUMERIC := 0;
    v_sales_0 NUMERIC := 0;
    v_sales_total NUMERIC := 0;
    v_sales_count INT := 0;
    v_sales_subtotal NUMERIC := 0;
    v_purchases_16 NUMERIC := 0;
    v_purchases_8 NUMERIC := 0;
    v_purchases_0 NUMERIC := 0;
    v_purchases_total NUMERIC := 0;
    v_purchases_count INT := 0;
    v_purchases_subtotal NUMERIC := 0;
    v_last_sale TIMESTAMP WITH TIME ZONE;
    v_last_purchase TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Ventas: issued_invoices
    SELECT
        COALESCE(SUM(CASE WHEN COALESCE(vat_total, 0) > 0 THEN subtotal ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(vat_total, 0) > 0 THEN vat_total ELSE 0 END), 0),
        COUNT(*),
        MAX(COALESCE(invoice_date, created_at))
    INTO v_sales_subtotal, v_sales_total, v_sales_count, v_last_sale
    FROM public.issued_invoices
    WHERE to_char(coalesce(invoice_date, created_at), 'YYYY-MM') = target_period;

    -- Note: a single rate; for the MVP we put all in 16% bucket. The 0% bucket is computed separately.
    -- A real distinction would require parsing line items; for now we attribute to 16%.
    v_sales_16 := v_sales_total;
    v_sales_0 := 0;

    -- Compras: union of purchase_orders (con XML) and invoice_inbox (aprobadas/pendientes)
    SELECT
        COALESCE(SUM(subtotal), 0),
        COALESCE(SUM(vat_total), 0),
        COUNT(*),
        MAX(invoice_date)
    INTO v_purchases_subtotal, v_purchases_total, v_purchases_count, v_last_purchase
    FROM (
        SELECT subtotal, vat_total, invoice_date
        FROM public.purchase_orders
        WHERE invoice_uuid IS NOT NULL
          AND to_char(coalesce(invoice_date, created_at), 'YYYY-MM') = target_period
        UNION ALL
        SELECT subtotal, vat_total, invoice_date
        FROM public.invoice_inbox
        WHERE status IN ('approved', 'pending')
          AND to_char(coalesce(invoice_date, created_at), 'YYYY-MM') = target_period
    ) s;

    v_purchases_16 := v_purchases_total;
    v_purchases_0 := 0;

    INSERT INTO public.monthly_iva_summary (
        period,
        total_ventas_gravadas, iva_cobrado_16, iva_cobrado_8, iva_cobrado_0, iva_cobrado_total,
        total_compras_gravadas, iva_acreditable_16, iva_acreditable_8, iva_acreditable_0, iva_acreditable_total,
        invoice_count_sales, invoice_count_purchases,
        last_sale_at, last_purchase_at,
        updated_at
    ) VALUES (
        target_period,
        v_sales_subtotal, v_sales_16, v_sales_8, v_sales_0, v_sales_total,
        v_purchases_subtotal, v_purchases_16, v_purchases_8, v_purchases_0, v_purchases_total,
        v_sales_count, v_purchases_count,
        v_last_sale, v_last_purchase,
        NOW()
    )
    ON CONFLICT (period) DO UPDATE SET
        total_ventas_gravadas = EXCLUDED.total_ventas_gravadas,
        iva_cobrado_16 = EXCLUDED.iva_cobrado_16,
        iva_cobrado_8 = EXCLUDED.iva_cobrado_8,
        iva_cobrado_0 = EXCLUDED.iva_cobrado_0,
        iva_cobrado_total = EXCLUDED.iva_cobrado_total,
        total_compras_gravadas = EXCLUDED.total_compras_gravadas,
        iva_acreditable_16 = EXCLUDED.iva_acreditable_16,
        iva_acreditable_8 = EXCLUDED.iva_acreditable_8,
        iva_acreditable_0 = EXCLUDED.iva_acreditable_0,
        iva_acreditable_total = EXCLUDED.iva_acreditable_total,
        invoice_count_sales = EXCLUDED.invoice_count_sales,
        invoice_count_purchases = EXCLUDED.invoice_count_purchases,
        last_sale_at = EXCLUDED.last_sale_at,
        last_purchase_at = EXCLUDED.last_purchase_at,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- 4) Trigger: after insert/update/delete on issued_invoices → recompute
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_recompute_iva_sales()
RETURNS TRIGGER AS $$
DECLARE
    p TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        p := to_char(coalesce(OLD.invoice_date, OLD.created_at), 'YYYY-MM');
        PERFORM public.recompute_monthly_iva_summary(p);
        RETURN OLD;
    END IF;
    p := to_char(coalesce(NEW.invoice_date, NEW.created_at), 'YYYY-MM');
    PERFORM public.recompute_monthly_iva_summary(p);
    -- Also recompute the OLD period in case date changed
    IF TG_OP = 'UPDATE' AND OLD.invoice_date IS DISTINCT FROM NEW.invoice_date THEN
        PERFORM public.recompute_monthly_iva_summary(to_char(coalesce(OLD.invoice_date, OLD.created_at), 'YYYY-MM'));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iva_sales ON public.issued_invoices;
CREATE TRIGGER trg_iva_sales
    AFTER INSERT OR UPDATE OR DELETE ON public.issued_invoices
    FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_iva_sales();

-- -----------------------------------------------------
-- 5) Trigger: after insert/update/delete on invoice_inbox → recompute
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_recompute_iva_purchases()
RETURNS TRIGGER AS $$
DECLARE
    p TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        p := to_char(coalesce(OLD.invoice_date, OLD.created_at), 'YYYY-MM');
        PERFORM public.recompute_monthly_iva_summary(p);
        RETURN OLD;
    END IF;
    p := to_char(coalesce(NEW.invoice_date, NEW.created_at), 'YYYY-MM');
    PERFORM public.recompute_monthly_iva_summary(p);
    IF TG_OP = 'UPDATE' AND (OLD.invoice_date IS DISTINCT FROM NEW.invoice_date OR OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM public.recompute_monthly_iva_summary(to_char(coalesce(OLD.invoice_date, OLD.created_at), 'YYYY-MM'));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iva_purchases_inbox ON public.invoice_inbox;
CREATE TRIGGER trg_iva_purchases_inbox
    AFTER INSERT OR UPDATE OR DELETE ON public.invoice_inbox
    FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_iva_purchases();

-- -----------------------------------------------------
-- 6) Trigger: purchase_orders (a veces también traen VAT cuando se reciben)
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_recompute_iva_purchase_orders()
RETURNS TRIGGER AS $$
DECLARE
    p TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        p := to_char(coalesce(OLD.invoice_date, OLD.created_at), 'YYYY-MM');
        PERFORM public.recompute_monthly_iva_summary(p);
        RETURN OLD;
    END IF;
    p := to_char(coalesce(NEW.invoice_date, NEW.created_at), 'YYYY-MM');
    PERFORM public.recompute_monthly_iva_summary(p);
    IF TG_OP = 'UPDATE' AND OLD.invoice_date IS DISTINCT FROM NEW.invoice_date THEN
        PERFORM public.recompute_monthly_iva_summary(to_char(coalesce(OLD.invoice_date, OLD.created_at), 'YYYY-MM'));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_iva_purchases_po ON public.purchase_orders;
CREATE TRIGGER trg_iva_purchases_po
    AFTER INSERT OR UPDATE OR DELETE ON public.purchase_orders
    FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_iva_purchase_orders();

-- -----------------------------------------------------
-- 7) Backfill summary for the last 12 months so it's not empty
-- -----------------------------------------------------
DO $$
DECLARE
    i INT;
    target TEXT;
BEGIN
    FOR i IN 0..11 LOOP
        target := to_char((CURRENT_DATE - (i || ' months')::INTERVAL), 'YYYY-MM');
        PERFORM public.recompute_monthly_iva_summary(target);
    END LOOP;
END $$;
