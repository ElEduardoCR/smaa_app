-- =====================================================
-- Módulo Cuentas por Cobrar (AR / Accounts Receivable)
-- =====================================================
-- 2026-07-29
--
-- Tablas:
--   ar_invoices                 — partidas/facturas que el cliente debe
--   ar_payments                 — pagos recibidos
--   ar_payment_allocations      — many-to-many pago ↔ factura
--   ar_share_links              — links públicos (token hasheado) por cliente
--   ar_payment_promises         — promesas que el cliente manda desde el link
--   ar_payment_promise_items    — qué facturas incluyó en la promesa
--
-- Convenciones:
--   * IVA siempre 16% (la columna vat_amount se calcula server-side, no se confía
--     en lo que mande el cliente desde el form)
--   * gross_amount = subtotal sin IVA
--   * vat_amount   = gross * 0.16
--   * net_amount   = gross + vat
--   * balance      = net_amount - paid_amount  (generado)
--   * status       = pending | partial | paid | cancelled
--   * is_active    = soft-delete (no se borra, preserva audit trail)
-- =====================================================

-- -----------------------------------------------------
-- 1) ar_invoices
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ar_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cliente (FK a clients, bigint)
    client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,

    -- Origen de la partida
    source_type TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_type IN ('manual', 'issued_cfdi', 'sale')),
    source_id UUID NULL,  -- FK lógica a issued_invoices.id cuando source_type='issued_cfdi'

    -- Identificación de la factura
    invoice_number TEXT NULL,                 -- folio del CFDI o número manual
    concept TEXT NOT NULL,                    -- descripción del trabajo/servicio
    work_date DATE NULL,                      -- cuándo se hizo el trabajo
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,  -- cuándo se asignó/facturó
    due_date DATE NULL,                       -- fecha límite de pago

    -- Montos (gross = sin IVA, vat siempre 16% del gross)
    gross_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
    vat_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount   >= 0),
    net_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (net_amount   >= 0),
    paid_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount  >= 0),
    balance      NUMERIC(14,2) GENERATED ALWAYS AS (net_amount - paid_amount) STORED,

    -- Estado
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
    notes TEXT NULL,

    -- Soft-delete
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES public.employees(id) ON DELETE SET NULL,
    updated_by UUID NULL REFERENCES public.employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ar_invoices_client
    ON public.ar_invoices (client_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ar_invoices_status_open
    ON public.ar_invoices (status) WHERE status IN ('pending', 'partial') AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_ar_invoices_invoice_date
    ON public.ar_invoices (invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_ar_invoices_source
    ON public.ar_invoices (source_type, source_id) WHERE source_id IS NOT NULL;

-- -----------------------------------------------------
-- 2) ar_payments
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ar_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL DEFAULT 'transfer'
        CHECK (payment_method IN ('transfer', 'cash', 'check', 'card', 'other')),
    reference TEXT NULL,           -- referencia bancaria, número de cheque, etc.
    notes TEXT NULL,
    registered_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_payments_client
    ON public.ar_payments (client_id, payment_date DESC);

-- -----------------------------------------------------
-- 3) ar_payment_allocations  (pago ↔ factura)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ar_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.ar_payments(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES public.ar_invoices(id) ON DELETE RESTRICT,
    amount_applied NUMERIC(14,2) NOT NULL CHECK (amount_applied > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_ar_allocations_invoice
    ON public.ar_payment_allocations (invoice_id);

-- -----------------------------------------------------
-- 4) ar_share_links  (links públicos al estado de cuenta)
-- -----------------------------------------------------
-- El token en la URL es la mitad visible (32+ chars random). En BD guardamos
-- SOLO su SHA-256, para que un dump de la tabla no sirva para generar links.
CREATE TABLE IF NOT EXISTS public.ar_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hex del token crudo
    label TEXT NULL,                  -- p.ej. "Enviado a Juan el 29/07"
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'revoked', 'expired')),
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NULL,
    access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ar_share_links_client
    ON public.ar_share_links (client_id, created_at DESC);

-- -----------------------------------------------------
-- 5) ar_payment_promises
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ar_payment_promises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id BIGINT NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    share_link_id UUID NOT NULL REFERENCES public.ar_share_links(id) ON DELETE CASCADE,
    promise_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_payment_date DATE NULL,
    total_committed NUMERIC(14,2) NOT NULL CHECK (total_committed > 0),
    client_notes TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'fulfilled', 'expired', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_promises_client
    ON public.ar_payment_promises (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ar_promises_status
    ON public.ar_payment_promises (status) WHERE status = 'pending';

-- -----------------------------------------------------
-- 6) ar_payment_promise_items
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ar_payment_promise_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promise_id UUID NOT NULL REFERENCES public.ar_payment_promises(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES public.ar_invoices(id) ON DELETE RESTRICT,
    amount_committed NUMERIC(14,2) NOT NULL CHECK (amount_committed > 0)
);

CREATE INDEX IF NOT EXISTS idx_ar_promise_items_promise
    ON public.ar_payment_promise_items (promise_id);

CREATE INDEX IF NOT EXISTS idx_ar_promise_items_invoice
    ON public.ar_payment_promise_items (invoice_id);

-- -----------------------------------------------------
-- Trigger: al insertar/actualizar una ar_invoice, recalcular paid_amount y status
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.ar_recalc_invoice()
RETURNS TRIGGER AS $$
DECLARE
    total_paid NUMERIC(14,2);
    new_status TEXT;
BEGIN
    SELECT COALESCE(SUM(amount_applied), 0)
      INTO total_paid
      FROM public.ar_payment_allocations
     WHERE invoice_id = NEW.invoice_id;

    NEW.paid_amount := total_paid;

    IF NEW.status = 'cancelled' THEN
        new_status := 'cancelled';
    ELSIF total_paid <= 0 THEN
        new_status := 'pending';
    ELSIF total_paid >= NEW.net_amount THEN
        new_status := 'paid';
    ELSE
        new_status := 'partial';
    END IF;

    IF NEW.status <> 'cancelled' THEN
        NEW.status := new_status;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ar_recalc_invoice ON public.ar_payment_allocations;
CREATE TRIGGER trg_ar_recalc_invoice
    AFTER INSERT OR UPDATE OR DELETE ON public.ar_payment_allocations
    FOR EACH ROW EXECUTE FUNCTION public.ar_recalc_invoice();

-- -----------------------------------------------------
-- RLS: "Allow all" como el resto del schema.
-- (El control de acceso real se hace en server actions con requirePermission.)
-- -----------------------------------------------------
ALTER TABLE public.ar_invoices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_payment_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_share_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_payment_promises     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_payment_promise_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all ar_invoices"              ON public.ar_invoices;
DROP POLICY IF EXISTS "Allow all ar_payments"              ON public.ar_payments;
DROP POLICY IF EXISTS "Allow all ar_payment_allocations"   ON public.ar_payment_allocations;
DROP POLICY IF EXISTS "Allow all ar_share_links"           ON public.ar_share_links;
DROP POLICY IF EXISTS "Allow all ar_payment_promises"      ON public.ar_payment_promises;
DROP POLICY IF EXISTS "Allow all ar_payment_promise_items" ON public.ar_payment_promise_items;

CREATE POLICY "Allow all ar_invoices"              ON public.ar_invoices              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all ar_payments"              ON public.ar_payments              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all ar_payment_allocations"   ON public.ar_payment_allocations   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all ar_share_links"           ON public.ar_share_links           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all ar_payment_promises"      ON public.ar_payment_promises      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all ar_payment_promise_items" ON public.ar_payment_promise_items FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- Comentarios para documentar el modelo
-- -----------------------------------------------------
COMMENT ON TABLE public.ar_invoices IS
    'Cuentas por cobrar. Cada fila es una partida/factura asignada a un cliente. gross es sin IVA, vat es 16% del gross, net = gross + vat. balance se calcula solo.';
COMMENT ON COLUMN public.ar_invoices.source_type IS
    'manual = capturada a mano; issued_cfdi = importada de issued_invoices; sale = vendrá de ventas';
COMMENT ON COLUMN public.ar_invoices.is_active IS
    'Soft-delete. false = obsoleto (no se borra, preserva audit trail)';

COMMENT ON TABLE public.ar_share_links IS
    'Links públicos para que el cliente vea su estado de cuenta sin login. Solo guardamos el hash SHA-256 del token, nunca el token crudo.';
COMMENT ON TABLE public.ar_payment_promises IS
    'Promesa de pago creada por el cliente desde el link público.';
