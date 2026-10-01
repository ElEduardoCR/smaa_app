-- =====================================================
-- Cuentas por Cobrar: ligar el pago a la promesa que cumple
-- =====================================================
-- Al marcar una promesa como "Cumplida" ahora se registra el pago real
-- (monto exacto prometido u otra cantidad). promise_id permite saber qué
-- promesas ya tienen su pago registrado y cuáles se marcaron como cumplidas
-- antes de este cambio (sin pago).
-- =====================================================

ALTER TABLE public.ar_payments
    ADD COLUMN IF NOT EXISTS promise_id UUID NULL
        REFERENCES public.ar_payment_promises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ar_payments_promise
    ON public.ar_payments (promise_id) WHERE promise_id IS NOT NULL;

COMMENT ON COLUMN public.ar_payments.promise_id IS
    'Promesa de pago que este pago cumplió (NULL = pago capturado sin promesa).';
