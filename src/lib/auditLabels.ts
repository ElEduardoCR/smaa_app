// ===========================================================================
// Presentación de la bitácora de ediciones (audit_log): nombres de tablas y
// campos, y formato de valores. Se usa en el historial de cada registro y en
// la bitácora general.
// ===========================================================================

export type AuditRootTable = 'quotations' | 'purchase_orders' | 'work_orders' | 'ar_invoices' | 'vehicles';

export type HistoryEntry = {
    id: number;
    occurredAt: string;
    table: string;
    recordId: string;
    rootTable: AuditRootTable;
    rootId: string;
    rootFolio: string | null;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
    changedFields: string[] | null;
    oldData: Record<string, unknown> | null;
    newData: Record<string, unknown> | null;
    actorId: string | null;
    actorName: string | null;
    source: string;
    reason: string | null;
    txid: number;
};

export const ROOT_LABEL: Record<AuditRootTable, string> = {
    quotations: 'Cotización',
    purchase_orders: 'Compra',
    work_orders: 'Orden de trabajo',
    ar_invoices: 'Cuenta por cobrar',
    vehicles: 'Vehículo',
};

export const TABLE_LABEL: Record<string, string> = {
    quotations: 'Cotización',
    quotation_items: 'Partida',
    purchase_orders: 'Compra',
    purchase_order_items: 'Artículo',
    work_orders: 'OT',
    work_order_stages: 'Etapa',
    work_order_closures: 'Cierre de piezas',
    work_order_pauses: 'Pausa',
    work_order_wps: 'WPS',
    work_order_operators: 'Operador asignado',
    deliveries: 'Entrega',
    ar_invoices: 'Cuenta por cobrar',
    vehicles: 'Vehículo',
    vehicle_documents: 'Documento',
    vehicle_services: 'Servicio',
    vehicle_expenses: 'Gasto',
    vehicle_files: 'Archivo',
};

const FIELD_LABEL: Record<string, string> = {
    title: 'Nombre', status: 'Estado', client_id: 'Cliente', seller: 'Vendedor', delivery_time: 'Tiempo de entrega',
    delivery_date: 'Fecha de entrega', terms_conditions: 'Términos y condiciones', commissioners: 'Comisionados',
    subtotal: 'Subtotal', vat_total: 'IVA', total: 'Total', client_po_url: 'OC del cliente', billed_manually: 'Facturada a mano',
    description: 'Descripción', quantity: 'Cantidad', unit_price: 'Precio unitario', line_total: 'Importe',
    cost_unit_price: 'Costo unitario', cost_line_total: 'Costo', margin_pct: 'Utilidad %', item_type: 'Tipo',
    service_concepts: 'Conceptos del servicio', is_extra: 'Extra', extra_note: 'Nota del extra',
    supplier_id: 'Proveedor', notes: 'Notas', invoice_url: 'Factura', is_active: 'Activo', requisition_id: 'Requisición',
    work_title: 'Título', priority: 'Prioridad', unit: 'Unidad', client_name: 'Cliente', client_rfc: 'RFC',
    module_id: 'Proceso', sequence: 'Orden', started_at: 'Inicio', paused_at: 'Pausa', completed_at: 'Terminada',
    operator_name: 'Operador', operator_signature_url: 'Firma del operador', qc_released_at: 'Liberada',
    qc_released_by: 'Liberada por', qc_rejected_at: 'Rechazo', qc_reject_reason: 'Motivo de rechazo',
    cancel_reason: 'Motivo de cancelación', cancelled_at: 'Cancelada', order_kind: 'Tipo de OT',
    qc_status: 'Calidad', qc_released_qty: 'Piezas liberadas', qc_rejected_qty: 'Piezas rechazadas',
    qc_decided_by_name: 'Inspector', qc_comments: 'Comentarios de Calidad', signature_url: 'Firma',
    reason: 'Motivo', custom_reason: 'Motivo', resumed_at: 'Reanudada', paused_by: 'Pausada por',
    delivery_number: 'Nota de entrega', stage: 'Etapa de entrega', packaged_at: 'Empacada', delivered_at: 'Entregada',
    shipping_method: 'Envío', shipping_address: 'Dirección', shipping_carrier: 'Paquetería', tracking_number: 'Guía',
    observations: 'Observaciones', employee_id: 'Empleado', role: 'Rol', wps_id: 'WPS',
    concept: 'Concepto', invoice_number: 'Folio', invoice_date: 'Fecha', due_date: 'Vence', gross_amount: 'Subtotal',
    vat_amount: 'IVA', net_amount: 'Total', paid_amount: 'Pagado', sale_origin: 'Origen',
    alias: 'Nombre', brand: 'Marca', model: 'Modelo', year: 'Año', plates: 'Placas', vin: 'Serie (VIN)',
    engine_number: 'Motor', color: 'Color', fuel_type: 'Combustible', odometer_km: 'Kilometraje',
    responsible_employee_id: 'Responsable', oil_interval_km: 'Aceite cada (km)', oil_interval_months: 'Aceite cada (meses)',
    doc_type: 'Tipo', provider: 'Proveedor / aseguradora', document_number: 'Número', coverage: 'Cobertura',
    issued_at: 'Inicio de vigencia', expires_at: 'Vence', cost: 'Costo', service_date: 'Fecha', items: 'Servicios',
    workshop: 'Taller', next_service_date: 'Próximo servicio', next_service_km: 'Próximo servicio (km)',
    expense_date: 'Fecha', category: 'Categoría', amount: 'Importe', liters: 'Litros', file_id: 'Archivo',
    caption: 'Descripción', file_name: 'Archivo', kind: 'Tipo', cover_file_id: 'Foto de portada',
};

/** Campos técnicos que no aportan al historial. */
const HIDDEN_FIELDS = new Set([
    'id', 'created_at', 'updated_at', 'quotation_id', 'purchase_order_id', 'work_order_id', 'vehicle_id', 'stage_id',
    'closure_id', 'created_by', 'updated_by', 'created_by_name', 'closed_by', 'qc_decided_by', 'added_by', 'added_at',
    'source_id', 'source_type', 'purchase_group_id', 'storage_path', 'content_type', 'file_size', 'uploaded_by',
    'uploaded_by_name', 'warranty_cycle', 'is_final', 'sequence_no', 'odometer_updated_at', 'balance', 'txid',
    'email_message_id', 'parent_work_order_id', 'warranty_count', 'qc_approved', 'qc_approved_at', 'qc_signature_url', 'position',
]);

const MONEY_FIELDS = new Set(['subtotal', 'vat_total', 'total', 'unit_price', 'line_total', 'cost_unit_price', 'cost_line_total',
    'gross_amount', 'vat_amount', 'net_amount', 'paid_amount', 'cost', 'amount']);

const STATUS_LABEL: Record<string, string> = {
    Draft: 'Borrador', Sent: 'Enviada', Approved: 'Aprobada', Rejected: 'Rechazada', Received: 'Recibida', Confirmed: 'Confirmada',
    Open: 'Abierta', 'In Progress': 'En curso', Paused: 'Pausada', Completed: 'Terminada', QC: 'En calidad',
    QC_Released: 'Liberada', Cancelled: 'Cancelada', Pending: 'Pendiente', Done: 'Terminada',
    pending: 'Pendiente', partial: 'Parcial', paid: 'Pagada', cancelled: 'Cancelada', released: 'Liberado', rejected: 'Rechazado',
    not_required: 'No aplica', ready_for_packaging: 'Lista para embalaje', delivered: 'Entregada',
    garantia: 'Garantía', reparacion: 'Reparación', normal: 'Normal', product: 'Producto', service: 'Servicio',
    fabricacion: 'Fabricación', venta_directa: 'Venta directa', trabajo_previo: 'Trabajo ya realizado',
};

export function fieldLabel(field: string): string {
    return FIELD_LABEL[field] || field.replace(/_/g, ' ');
}

export function isVisibleField(field: string): boolean {
    return !HIDDEN_FIELDS.has(field);
}

export function formatAuditValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (MONEY_FIELDS.has(field) && Number.isFinite(Number(value))) {
        return Number(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    if (typeof value === 'string') {
        if (STATUS_LABEL[value] && ['status', 'qc_status', 'stage', 'order_kind', 'item_type', 'sale_origin'].includes(field)) return STATUS_LABEL[value];
        if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const [y, m, d] = value.split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('es-MX', { dateStyle: 'medium' });
        }
        if (/^https?:\/\//.test(value)) return 'archivo adjunto';
        return value.length > 160 ? `${value.slice(0, 160)}…` : value;
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return '—';
        if (value.every((v) => typeof v === 'string')) return value.join(', ');
        return `${value.length} elemento(s)`;
    }
    if (typeof value === 'object') return 'datos estructurados';
    return String(value);
}

/** Etiqueta corta de lo que representa una fila (p. ej. la descripción de la partida). */
export function rowLabel(entry: HistoryEntry): string | null {
    const data = entry.newData || entry.oldData || {};
    const pick = (key: string) => (typeof data[key] === 'string' && data[key] ? String(data[key]) : null);
    return pick('description') || pick('delivery_number') || pick('reason') || pick('operator_name') || pick('alias')
        || pick('document_number') || pick('category') || pick('file_name') || null;
}

export type ChangeLine = { field: string; label: string; before: string; after: string };

export function changeLines(entry: HistoryEntry): ChangeLine[] {
    if (entry.operation === 'UPDATE') {
        return (entry.changedFields || []).filter(isVisibleField).map((field) => ({
            field, label: fieldLabel(field),
            before: formatAuditValue(field, entry.oldData?.[field]),
            after: formatAuditValue(field, entry.newData?.[field]),
        }));
    }
    const data = (entry.operation === 'INSERT' ? entry.newData : entry.oldData) || {};
    return Object.keys(data).filter((field) => isVisibleField(field) && data[field] !== null && data[field] !== '' && data[field] !== false)
        .slice(0, 12)
        .map((field) => ({
            field, label: fieldLabel(field),
            before: entry.operation === 'DELETE' ? formatAuditValue(field, data[field]) : '',
            after: entry.operation === 'INSERT' ? formatAuditValue(field, data[field]) : '',
        }));
}

const OPERATION_LABEL: Record<string, [string, string, string]> = {
    // [alta, edición, baja]
    quotations: ['Cotización creada', 'Cotización modificada', 'Cotización eliminada'],
    quotation_items: ['Partida agregada', 'Partida modificada', 'Partida eliminada'],
    purchase_orders: ['Compra creada', 'Compra modificada', 'Compra eliminada'],
    purchase_order_items: ['Artículo agregado', 'Artículo modificado', 'Artículo eliminado'],
    work_orders: ['OT creada', 'OT modificada', 'OT eliminada'],
    work_order_stages: ['Etapa agregada', 'Etapa actualizada', 'Etapa eliminada'],
    work_order_closures: ['Cierre de piezas', 'Decisión de Calidad', 'Cierre eliminado'],
    work_order_pauses: ['Pausa registrada', 'Pausa actualizada', 'Pausa eliminada'],
    work_order_wps: ['WPS asignado', 'WPS modificado', 'WPS quitado'],
    work_order_operators: ['Operador asignado', 'Asignación modificada', 'Operador quitado'],
    deliveries: ['Nota de entrega creada', 'Entrega actualizada', 'Entrega eliminada'],
    ar_invoices: ['Cuenta por cobrar creada', 'Cuenta por cobrar modificada', 'Cuenta por cobrar eliminada'],
    vehicles: ['Vehículo dado de alta', 'Vehículo modificado', 'Vehículo eliminado'],
    vehicle_documents: ['Documento agregado', 'Documento modificado', 'Documento eliminado'],
    vehicle_services: ['Servicio registrado', 'Servicio modificado', 'Servicio eliminado'],
    vehicle_expenses: ['Gasto registrado', 'Gasto modificado', 'Gasto eliminado'],
    vehicle_files: ['Archivo subido', 'Archivo modificado', 'Archivo eliminado'],
};

export function operationLabel(entry: HistoryEntry): string {
    const labels = OPERATION_LABEL[entry.table];
    const index = entry.operation === 'INSERT' ? 0 : entry.operation === 'UPDATE' ? 1 : 2;
    if (labels) return labels[index];
    const what = TABLE_LABEL[entry.table] || entry.table;
    return `${what}: ${['alta', 'cambio', 'baja'][index]}`;
}

/** Un cambio sin autor verificado: se hizo fuera de las acciones del servidor. */
export function isUnverified(entry: HistoryEntry): boolean {
    return !entry.actorId && entry.source !== 'base de datos';
}
