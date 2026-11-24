-- =====================================================
-- NOTIFICACIONES
--
-- Avisos dentro de la app (campana del menú). Los generan triggers, así que
-- aparecen sin importar desde qué pantalla se hizo el cambio:
--   - Requisiciones nuevas y cambios de estado (al solicitante).
--   - OT nuevas, garantías/reparaciones, piezas que llegan a Calidad,
--     liberaciones y rechazos.
--   - Documentos nuevos, nuevas revisiones, requisiciones de documentos.
--   - Compras nuevas/recibidas, cotizaciones aprobadas o editadas después de
--     aprobarse, cuentas por cobrar nuevas, entregas confirmadas.
--   - Vehículos: documentos por vencer y servicios vencidos (ver vehicles).
--
-- Quién ve cada aviso: los empleados que pueden ver su módulo (module_code);
-- si trae recipient_id, sólo esa persona. Nadie recibe avisos de lo que hizo
-- él mismo. Todo se lee desde el servidor (service_role).
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    module_code text NOT NULL,
    sub_code text,
    event text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    entity_table text,
    entity_id text,
    actor_id uuid,
    actor_name text,
    recipient_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
    dedupe_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_module_idx ON public.notifications (module_code, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON public.notifications (recipient_id, created_at DESC) WHERE recipient_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_reads (
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    notification_id bigint NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, notification_id)
);

CREATE TABLE IF NOT EXISTS public.notification_state (
    employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    read_all_before timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['notifications', 'notification_reads', 'notification_state'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', v_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_server', v_table);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', v_table || '_server', v_table);
    END LOOP;
END;
$$;

-- Inserta un aviso con el autor de la petición actual (o el indicado).
CREATE OR REPLACE FUNCTION public.smaa_notify(p_module text, p_sub text, p_event text, p_title text, p_body text, p_link text,
    p_entity_table text, p_entity_id text, p_recipient uuid DEFAULT NULL, p_dedupe text DEFAULT NULL,
    p_fallback_actor uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor record; v_actor_id uuid; v_actor_name text;
BEGIN
    SELECT * INTO v_actor FROM public.smaa_request_actor();
    v_actor_id := coalesce(v_actor.actor_id, p_fallback_actor);
    v_actor_name := coalesce(v_actor.actor_name, (SELECT full_name FROM public.employees WHERE id = p_fallback_actor));
    -- Un aviso personal sobre lo que hizo uno mismo no tiene sentido.
    IF p_recipient IS NOT NULL AND p_recipient = v_actor_id THEN RETURN; END IF;
    INSERT INTO public.notifications (module_code, sub_code, event, title, body, link, entity_table, entity_id,
        actor_id, actor_name, recipient_id, dedupe_key)
    VALUES (p_module, p_sub, p_event, left(p_title, 300), left(p_body, 1000), p_link, p_entity_table, p_entity_id,
        v_actor_id, v_actor_name, p_recipient, p_dedupe)
    ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.smaa_notify(text, text, text, text, text, text, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.smaa_money(p numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT '$' || to_char(coalesce(p, 0), 'FM999,999,990.00')
$$;

-- -----------------------------------------------------
-- Requisiciones
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_requisition_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_requester text; v_label text;
BEGIN
    SELECT full_name INTO v_requester FROM public.employees WHERE id = NEW.requested_by;
    IF TG_OP = 'INSERT' THEN
        PERFORM public.smaa_notify('requisitions', NULL, 'requisition.created',
            'Nueva requisición ' || NEW.code || ' de ' || coalesce(v_requester, 'un empleado'),
            concat_ws(' · ', 'Prioridad ' || CASE NEW.priority WHEN 'low' THEN 'baja' WHEN 'normal' THEN 'normal' WHEN 'high' THEN 'alta' WHEN 'urgent' THEN 'urgente' ELSE NEW.priority END, CASE WHEN NEW.needed_by IS NOT NULL THEN 'para el ' || to_char(NEW.needed_by, 'DD/MM/YYYY') END,
                      nullif(left(coalesce(NEW.purpose, NEW.notes, ''), 160), '')),
            '/requisitions/' || NEW.id, 'requisitions', NEW.id::text, NULL, NULL, NEW.requested_by);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        v_label := CASE NEW.status WHEN 'purchased' THEN 'ya se compró' WHEN 'cancelled' THEN 'se canceló' ELSE 'cambió a ' || NEW.status END;
        PERFORM public.smaa_notify('requisitions', NULL, 'requisition.status',
            'Tu requisición ' || NEW.code || ' ' || v_label, NULL,
            '/requisitions/' || NEW.id, 'requisitions', NEW.id::text, NEW.requested_by);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_requisitions ON public.requisitions;
CREATE TRIGGER trg_notify_requisitions AFTER INSERT OR UPDATE OF status ON public.requisitions
FOR EACH ROW EXECUTE FUNCTION public.notify_requisition_change();

-- -----------------------------------------------------
-- Fabricación y Calidad
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_work_order_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client text; v_parent text;
BEGIN
    SELECT coalesce(nullif(c.name, ''), c.business_name) INTO v_client
      FROM public.quotations q JOIN public.clients c ON c.id = q.client_id WHERE q.id = NEW.quotation_id;
    IF NEW.order_kind IN ('garantia', 'reparacion') THEN
        SELECT order_number INTO v_parent FROM public.work_orders WHERE id = NEW.parent_work_order_id;
        PERFORM public.smaa_notify('manufacturing', NULL, 'work_order.' || NEW.order_kind,
            CASE NEW.order_kind WHEN 'garantia' THEN 'Garantía abierta ' ELSE 'Reparación abierta ' END || NEW.order_number,
            concat_ws(' · ', 'De ' || v_parent, coalesce(v_client, NEW.client_name), left(NEW.notes, 200)),
            '/manufacturing/ot/' || NEW.id, 'work_orders', NEW.id::text, NULL, NULL, NEW.created_by);
    ELSE
        PERFORM public.smaa_notify('manufacturing', NULL, 'work_order.created',
            'Nueva OT ' || NEW.order_number || ' — ' || coalesce(NEW.work_title, ''),
            concat_ws(' · ', coalesce(v_client, NEW.client_name), trim_scale(NEW.quantity) || ' ' || NEW.unit, 'Prioridad ' || coalesce(NEW.priority, 'Normal')),
            '/manufacturing/ot/' || NEW.id, 'work_orders', NEW.id::text, NULL, NULL, NEW.created_by);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_work_orders ON public.work_orders;
CREATE TRIGGER trg_notify_work_orders AFTER INSERT ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_work_order_created();

CREATE OR REPLACE FUNCTION public.notify_work_order_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w public.work_orders; v_stage text;
BEGIN
    SELECT * INTO w FROM public.work_orders WHERE id = NEW.work_order_id;
    SELECT m.name INTO v_stage FROM public.work_order_stages s JOIN public.manufacturing_modules m ON m.id = s.module_id WHERE s.id = NEW.stage_id;
    IF TG_OP = 'INSERT' AND NEW.is_final THEN
        PERFORM public.smaa_notify('quality', NULL, 'closure.pending_qc',
            w.order_number || ': ' || trim_scale(NEW.quantity) || ' ' || w.unit || ' listas para Calidad',
            concat_ws(' · ', w.work_title, v_stage || ' cerrada por ' || NEW.operator_name),
            '/manufacturing/ot/' || w.id, 'work_order_closures', NEW.id::text);
    ELSIF TG_OP = 'UPDATE' AND NEW.qc_status IS DISTINCT FROM OLD.qc_status AND OLD.qc_status = 'pending' THEN
        IF coalesce(NEW.qc_released_qty, 0) > 0 THEN
            PERFORM public.smaa_notify('deliveries', NULL, 'closure.released',
                w.order_number || ': ' || trim_scale(NEW.qc_released_qty) || ' ' || w.unit || ' liberadas por Calidad',
                concat_ws(' · ', w.work_title, 'Listas para nota de entrega'),
                '/deliveries/new?ot=' || w.id, 'work_order_closures', NEW.id::text);
        END IF;
        IF coalesce(NEW.qc_rejected_qty, 0) > 0 THEN
            PERFORM public.smaa_notify('manufacturing', NULL, 'closure.rejected',
                'Calidad rechazó ' || trim_scale(NEW.qc_rejected_qty) || ' ' || w.unit || ' de ' || w.order_number,
                concat_ws(' · ', w.work_title, NEW.qc_comments),
                '/manufacturing/ot/' || w.id, 'work_order_closures', NEW.id::text);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_work_order_closures ON public.work_order_closures;
CREATE TRIGGER trg_notify_work_order_closures AFTER INSERT OR UPDATE OF qc_status ON public.work_order_closures
FOR EACH ROW EXECUTE FUNCTION public.notify_work_order_closure();

CREATE OR REPLACE FUNCTION public.notify_delivery_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w public.work_orders;
BEGIN
    IF NEW.stage = 'delivered' AND OLD.stage IS DISTINCT FROM 'delivered' THEN
        SELECT * INTO w FROM public.work_orders WHERE id = NEW.work_order_id;
        PERFORM public.smaa_notify('deliveries', NULL, 'delivery.delivered',
            'Entrega confirmada ' || NEW.delivery_number,
            concat_ws(' · ', w.order_number, w.work_title, CASE WHEN NEW.quantity IS NOT NULL THEN trim_scale(NEW.quantity) || ' ' || w.unit END),
            '/deliveries', 'deliveries', NEW.id::text);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_deliveries ON public.deliveries;
CREATE TRIGGER trg_notify_deliveries AFTER UPDATE OF stage ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_change();

-- -----------------------------------------------------
-- Documentos
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_document_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.smaa_notify('documents', NULL, 'document.created',
            'Nuevo documento ' || NEW.folio || ' — ' || NEW.title, NULL,
            '/documents/' || NEW.id, 'documents', NEW.id::text);
    ELSIF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.version IS DISTINCT FROM OLD.version THEN
        PERFORM public.smaa_notify('documents', NULL, 'document.revised',
            'Documento actualizado ' || NEW.folio || ' (rev. ' || NEW.revision || ')', NEW.title,
            '/documents/' || NEW.id, 'documents', NEW.id::text);
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'obsolete') THEN
        PERFORM public.smaa_notify('documents', NULL, 'document.status',
            'Documento ' || NEW.folio || CASE NEW.status WHEN 'approved' THEN ' aprobado' ELSE ' obsoleto' END, NEW.title,
            '/documents/' || NEW.id, 'documents', NEW.id::text);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_documents ON public.documents;
CREATE TRIGGER trg_notify_documents AFTER INSERT OR UPDATE OF revision, version, status ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.notify_document_change();

CREATE OR REPLACE FUNCTION public.notify_document_entry_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.documents;
BEGIN
    IF NEW.status = 'finalized' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'finalized' OR NEW.revision IS DISTINCT FROM OLD.revision) THEN
        SELECT * INTO d FROM public.documents WHERE id = NEW.document_id;
        PERFORM public.smaa_notify('documents', NULL, 'document_entry.finalized',
            CASE WHEN TG_OP = 'UPDATE' AND OLD.status = 'finalized' THEN 'Registro actualizado ' ELSE 'Nuevo registro ' END || coalesce(NEW.folio, d.folio),
            concat_ws(' · ', d.folio || ' ' || d.title, NEW.created_by_name),
            '/documents/' || NEW.document_id, 'document_entries', NEW.id::text, NULL, NULL, NEW.created_by);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_document_entries ON public.document_entries;
CREATE TRIGGER trg_notify_document_entries AFTER INSERT OR UPDATE OF status, revision ON public.document_entries
FOR EACH ROW EXECUTE FUNCTION public.notify_document_entry_change();

CREATE OR REPLACE FUNCTION public.notify_document_request_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_requester text; v_label text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT full_name INTO v_requester FROM public.employees WHERE id = NEW.requested_by;
        PERFORM public.smaa_notify('document_requests', NULL, 'document_request.created',
            CASE NEW.type WHEN 'new' THEN 'Solicitud de documento nuevo: ' ELSE 'Solicitud de cambio: ' END || NEW.title,
            concat_ws(' · ', v_requester, left(NEW.reason, 200)),
            '/documents/requests/' || NEW.id, 'document_requests', NEW.id::text, NULL, NULL, NEW.requested_by);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        v_label := CASE NEW.status
            WHEN 'pending_top_mgmt' THEN 'pasó a Alta Dirección'
            WHEN 'rejected_by_doc_control' THEN 'fue rechazada por Control de Documentos'
            WHEN 'rejected' THEN 'fue rechazada por Alta Dirección'
            WHEN 'approved' THEN 'fue aprobada'
            WHEN 'published' THEN 'ya se publicó'
            WHEN 'cancelled' THEN 'se canceló'
            ELSE 'cambió de estado' END;
        PERFORM public.smaa_notify('document_requests', NULL, 'document_request.status',
            'Tu solicitud "' || NEW.title || '" ' || v_label, NULL,
            '/documents/requests/' || NEW.id, 'document_requests', NEW.id::text, NEW.requested_by);
        IF NEW.status = 'pending_top_mgmt' THEN
            PERFORM public.smaa_notify('document_requests', NULL, 'document_request.needs_approval',
                'Solicitud de documento por aprobar: ' || NEW.title, NULL,
                '/documents/requests/' || NEW.id, 'document_requests', NEW.id::text);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_document_requests ON public.document_requests;
CREATE TRIGGER trg_notify_document_requests AFTER INSERT OR UPDATE OF status ON public.document_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_document_request_change();

-- -----------------------------------------------------
-- Comercial
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_purchase_order_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_supplier text;
BEGIN
    SELECT coalesce(nullif(name, ''), business_name) INTO v_supplier FROM public.suppliers WHERE id = NEW.supplier_id;
    IF TG_OP = 'INSERT' THEN
        PERFORM public.smaa_notify('purchases', NULL, 'purchase.created',
            'Nueva compra ' || coalesce(NEW.po_number, '') || CASE WHEN v_supplier IS NOT NULL THEN ' — ' || v_supplier ELSE '' END,
            'Total ' || public.smaa_money(NEW.total), '/purchases/' || NEW.id, 'purchase_orders', NEW.id::text);
    ELSIF NEW.status = 'Received' AND OLD.status IS DISTINCT FROM 'Received' THEN
        PERFORM public.smaa_notify('purchases', NULL, 'purchase.received',
            'Compra recibida ' || coalesce(NEW.po_number, ''), v_supplier, '/purchases/' || NEW.id, 'purchase_orders', NEW.id::text);
    ELSIF NEW.total IS DISTINCT FROM OLD.total AND OLD.status <> 'Draft' THEN
        PERFORM public.smaa_notify('purchases', NULL, 'purchase.edited',
            'Compra editada ' || coalesce(NEW.po_number, '') || ': ' || public.smaa_money(OLD.total) || ' → ' || public.smaa_money(NEW.total),
            v_supplier, '/purchases/' || NEW.id, 'purchase_orders', NEW.id::text);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_purchase_orders ON public.purchase_orders;
CREATE TRIGGER trg_notify_purchase_orders AFTER INSERT OR UPDATE OF status, total ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_purchase_order_change();

CREATE OR REPLACE FUNCTION public.notify_quotation_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client text;
BEGIN
    SELECT coalesce(nullif(name, ''), business_name) INTO v_client FROM public.clients WHERE id = NEW.client_id;
    IF NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM 'Approved' THEN
        PERFORM public.smaa_notify('sales', NULL, 'quotation.approved',
            'Cotización aprobada ' || NEW.quotation_number || coalesce(' — ' || nullif(NEW.title, ''), ''),
            concat_ws(' · ', v_client, 'Total ' || public.smaa_money(NEW.total)),
            '/sales?q=' || NEW.quotation_number, 'quotations', NEW.id::text);
    ELSIF NEW.total IS DISTINCT FROM OLD.total AND OLD.status = 'Approved' THEN
        PERFORM public.smaa_notify('sales', NULL, 'quotation.edited',
            'Cotización aprobada editada ' || NEW.quotation_number || ': ' || public.smaa_money(OLD.total) || ' → ' || public.smaa_money(NEW.total),
            v_client, '/sales?q=' || NEW.quotation_number, 'quotations', NEW.id::text);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_quotations ON public.quotations;
CREATE TRIGGER trg_notify_quotations AFTER UPDATE OF status, total ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.notify_quotation_change();

CREATE OR REPLACE FUNCTION public.notify_receivable_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_client text;
BEGIN
    IF NEW.source_type = 'sale' THEN
        SELECT coalesce(nullif(name, ''), business_name) INTO v_client FROM public.clients WHERE id = NEW.client_id;
        PERFORM public.smaa_notify('finance', 'receivable', 'receivable.created',
            'Nueva cuenta por cobrar ' || coalesce(NEW.invoice_number, '') || ' — ' || coalesce(v_client, ''),
            concat_ws(' · ', NEW.concept, public.smaa_money(NEW.net_amount), 'vence ' || to_char(NEW.due_date, 'DD/MM/YYYY')),
            '/finance/receivable/' || NEW.client_id, 'ar_invoices', NEW.id::text, NULL, NULL, NEW.created_by);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_ar_invoices ON public.ar_invoices;
CREATE TRIGGER trg_notify_ar_invoices AFTER INSERT ON public.ar_invoices
FOR EACH ROW EXECUTE FUNCTION public.notify_receivable_created();

COMMIT;
