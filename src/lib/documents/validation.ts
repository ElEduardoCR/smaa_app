import type { DigitalField, DigitalRow, DigitalTemplate, DigitalValues } from './schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'signature']);
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function assertDigitalId(value: unknown, label = 'Identificador'): asserts value is string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} no válido.`);
}

export function readDigitalTemplate(value: unknown): DigitalTemplate {
    if (!object(value) || typeof value.key !== 'string' || value.key.length > 128 || typeof value.code !== 'string' || value.code.length > 80 ||
        typeof value.title !== 'string' || value.title.length > 400 || !Array.isArray(value.sections) || value.sections.length > 100) {
        throw new Error('El formato digital no está disponible. Actualiza el catálogo de documentos.');
    }
    const keys = new Set<string>();
    if (value.captureEnabled !== undefined && typeof value.captureEnabled !== 'boolean') throw new Error('Modo de documento no válido.');
    if (value.relatedCodes !== undefined && (!Array.isArray(value.relatedCodes) || value.relatedCodes.length > 100 || !value.relatedCodes.every(code => typeof code === 'string' && code.length <= 80))) throw new Error('Referencias documentales no válidas.');
    if (value.sourceEvidence !== undefined && (!Array.isArray(value.sourceEvidence) || value.sourceEvidence.length > 20 || value.sourceEvidence.some(source => !object(source) || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256) || source.storagePath !== `sources/${source.sha256}.pdf` || typeof source.label !== 'string' || source.label.length > 180 || typeof source.fileName !== 'string' || !source.fileName.toLowerCase().endsWith('.pdf') || /[/\\]/.test(source.fileName)))) throw new Error('Evidencia de origen no válida.');
    const checkField = (field: unknown, seen: Set<string>) => {
        if (!object(field) || typeof field.key !== 'string' || !field.key || FORBIDDEN_KEYS.has(field.key) ||
            seen.has(field.key) || typeof field.label !== 'string' ||
            (field.type !== undefined && !FIELD_TYPES.has(String(field.type))) ||
            (field.options !== undefined && (!Array.isArray(field.options) || !field.options.every(v => typeof v === 'string')))) {
            throw new Error('La definición del formato contiene un campo no válido.');
        }
        seen.add(field.key);
    };
    for (const section of value.sections) {
        if (!object(section) || typeof section.title !== 'string') throw new Error('Sección de formato no válida.');
        if (section.paragraphs !== undefined && (!Array.isArray(section.paragraphs) || section.paragraphs.length > 300 ||
            !section.paragraphs.every(p => typeof p === 'string' && p.length <= 100_000))) throw new Error('Texto de documento no válido.');
        if (section.fields !== undefined && !Array.isArray(section.fields)) throw new Error('Campos de formato no válidos.');
        for (const field of (section.fields || []) as unknown[]) checkField(field, keys);
        if (section.table !== undefined) {
            const table = section.table;
            if (!object(table) || typeof table.key !== 'string' || !table.key || FORBIDDEN_KEYS.has(table.key) ||
                keys.has(table.key) || !Array.isArray(table.columns) || !table.columns.length || table.columns.length > 100) {
                throw new Error('Tabla de formato no válida.');
            }
            keys.add(table.key);
            const columns = new Set<string>();
            for (const field of table.columns) checkField(field, columns);
        }
        if (section.flow !== undefined) {
            const flow = section.flow;
            if (!object(flow) || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges) || flow.nodes.length > 200 || flow.edges.length > 600 ||
                typeof flow.width !== 'number' || !Number.isFinite(flow.width) || flow.width <= 0 ||
                typeof flow.height !== 'number' || !Number.isFinite(flow.height) || flow.height <= 0) throw new Error('Diagrama no válido.');
            const ids = new Set<string>();
            for (const node of flow.nodes) {
                if (!object(node) || typeof node.id !== 'string' || ids.has(node.id) || typeof node.label !== 'string' || node.label.length > 2000 ||
                    !['x', 'y', 'width', 'height'].every(key => typeof node[key] === 'number' && Number.isFinite(node[key]) && Number(node[key]) >= 0) ||
                    !node.width || !node.height) throw new Error('Paso de diagrama no válido.');
                ids.add(node.id);
            }
            if (flow.edges.some(edge => !object(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string' || !ids.has(edge.from) || !ids.has(edge.to) ||
                (edge.label !== undefined && typeof edge.label !== 'string'))) throw new Error('Conexión de diagrama no válida.');
        }
    }
    return value as unknown as DigitalTemplate;
}

function empty(value: unknown): boolean { return value === undefined || value === null || value === ''; }

function fieldValue(field: DigitalField, raw: unknown, final: boolean, label: string): string | number | boolean | null {
    if (empty(raw)) {
        if (final && field.required) throw new Error(`Completa ${label}.`);
        return field.type === 'checkbox' ? false : '';
    }
    if (field.type === 'checkbox') {
        if (typeof raw !== 'boolean') throw new Error(`${label}: selecciona una opción válida.`);
        if (final && field.required && !raw) throw new Error(`Confirma ${label}.`);
        return raw;
    }
    if (field.type === 'number') {
        if (typeof raw !== 'number' && typeof raw !== 'string') throw new Error(`${label}: indica un número.`);
        if (typeof raw === 'string' && !raw.trim()) {
            if (final && field.required) throw new Error(`Completa ${label}.`);
            return '';
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
            throw new Error(`${label}: número fuera del rango permitido.`);
        }
        return n;
    }
    if (field.readOnly && typeof raw === 'number') raw = String(raw);
    if (typeof raw !== 'string') throw new Error(`${label}: texto no válido.`);
    const value = raw.trim();
    if (final && field.required && !value) throw new Error(`Completa ${label}.`);
    if (field.type === 'signature') {
        if (!value) return '';
        if (value.length > 200_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
            throw new Error(`${label}: dibuja una firma válida.`);
        }
        const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
        if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
            bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 4096 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 2048) {
            throw new Error(`${label}: imagen de firma no válida.`);
        }
        return value;
    }
    if (value.length > (field.type === 'textarea' ? 20_000 : 4_000)) throw new Error(`${label}: texto demasiado largo.`);
    if (field.type === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) {
        throw new Error(`${label}: fecha no válida.`);
    }
    if (field.type === 'select' && value && !field.options?.includes(value)) throw new Error(`${label}: opción no válida.`);
    return value;
}

function requireRecorded(values: Record<string, unknown>, keys: string[], message: string) {
    if (keys.some(key => typeof values[key] !== 'string' || !String(values[key]).trim())) throw new Error(message);
}

function requireRecordedSigner(values: DigitalValues, prefix: string, message: string) {
    requireRecorded(values, [`${prefix}-nombre`, `${prefix}-fecha`, `${prefix}-firma`], message);
}

function requireClientDecision(values: Record<string, unknown>, name: string, date: string, evidence: string) {
    if (!['Sí', 'No', 'No aplica'].includes(String(values['requiere-cliente'] ?? ''))) {
        throw new Error('Resuelve si se requiere autorización del cliente antes de registrar esta decisión.');
    }
    if (values['requiere-cliente'] === 'Sí') {
        requireRecorded(values, [name, date, evidence], 'La autorización del cliente requiere nombre, fecha y evidencia de su aceptación.');
    }
}

function recordedRows(values: DigitalValues, key: string): DigitalRow[] {
    const rows = values[key];
    return Array.isArray(rows) ? rows.filter(row => Object.values(row).some(value => !empty(value) && value !== false)) : [];
}

/** Validate the decisions recorded in controlled forms. Saving a draft never
 * depends on these checks, so an incomplete or adverse result can be preserved
 * without inventing an approval or overwriting the underlying evidence. */
function validateControlledFormDecisions(template: DigitalTemplate, values: DigitalValues) {
    switch (template.key) {
        case 'revision-requisitos-cliente':
            if (values.resultado === 'Apto para comprometer') {
                requireRecordedSigner(values, 'autoriza', 'La aceptación del compromiso requiere nombre, fecha y firma de la autoridad interna.');
                requireRecorded(values, ['ubicacion-soportes'], 'Indica dónde se conserva la aceptación del cliente y los soportes de la revisión.');
                if (recordedRows(values, 'comprobaciones').some(row => ['No', 'Pendiente'].includes(String(row.resultado)))) {
                    throw new Error('El pedido no puede marcarse apto mientras una comprobación previa sea negativa o esté pendiente.');
                }
            }
            break;
        case 'plan-por-pedido':
            if (values['estado-plan'] === 'Cerrado') {
                requireRecorded(values, ['produccion-calidad', 'evidencia-entrega', 'facturacion'], 'El cierre del plan requiere vínculos con producción, liberación, entrega y expediente de facturación.');
            }
            break;
        case 'comunicacion-cambio-requisitos':
            if (values.decision === 'Autorizado') {
                requireRecordedSigner(values, 'autoridad', 'El cambio autorizado requiere nombre, fecha y firma de la autoridad interna.');
                requireClientDecision(values, 'confirma-cliente', 'fecha-cliente', 'evidencia-cliente');
                if (values['tipo-evento'] === 'Cambio de requisito') {
                    requireRecorded(values, ['antes', 'despues', 'razon', 'documentos-cambio'], 'Identifica el requisito anterior, el nuevo, el motivo y los documentos afectados antes de autorizar el cambio.');
                }
                if (recordedRows(values, 'impactos').some(row => row.afectado === 'Pendiente')) {
                    throw new Error('Completa la evaluación de impactos antes de autorizar el cambio de requisitos.');
                }
            }
            break;
        case 'hoja-viajera-inspeccion':
            if (values['verificable-despues'] === 'No') {
                requireRecorded(values, ['evaluacion-validacion', 'metodo-validacion', 'resultados-validacion', 'aprobo-validacion', 'firma-validacion', 'fecha-validacion', 'revalidacion'],
                    'Si el resultado no puede verificarse después, documenta la validación, sus resultados, aprobación y condiciones de revalidación.');
            }
            break;
        case 'propiedad-preservacion-entrega':
            if (['Entrega confirmada', 'Devolución confirmada'].includes(String(values['estado-operativo']))) {
                requireRecorded(values, ['fecha-entrega', 'recibio', 'evidencia-recepcion'], 'La entrega o devolución confirmada requiere fecha, receptor y evidencia real de recepción.');
                if (values['estado-operativo'] === 'Entrega confirmada') {
                    requireRecorded(values, ['liberacion'], 'Vincula la liberación de Calidad de la cantidad entregada.');
                }
            }
            break;
        case 'cambios-produccion-postentrega':
            if (values.decision === 'Autorizado') {
                requireRecordedSigner(values, 'autoriza', 'El cambio de producción autorizado requiere nombre, fecha y firma de quien autoriza.');
                requireClientDecision(values, 'acepta-cliente', 'fecha-acepta-cliente', 'evidencia-acepta-cliente');
                if (recordedRows(values, 'revision-tecnica').some(row => row.afectado === 'Pendiente')) {
                    throw new Error('Completa la revisión técnica antes de autorizar el cambio de producción.');
                }
            }
            break;
        case 'liberacion-productos-servicios': {
            const released = ['Liberación normal', 'Liberación parcial', 'Liberación excepcional antes de completar verificaciones'].includes(String(values.decision));
            if (released) {
                requireClientDecision(values, 'autoriza-cliente', 'fecha-cliente', 'evidencia-cliente');
                const quantity = values['cantidad-autorizada'];
                const reviewed = values['cantidad-revisada'];
                if (typeof quantity !== 'number' || typeof reviewed !== 'number' || quantity <= 0 || quantity > reviewed) {
                    throw new Error('La cantidad liberada debe ser mayor que cero y no puede exceder la cantidad revisada.');
                }
                if (values.decision === 'Liberación excepcional antes de completar verificaciones') {
                    requireRecorded(values, ['motivo-excepcion', 'verificaciones-pendientes', 'restricciones'], 'La liberación excepcional requiere motivo, verificaciones pendientes y restricciones.');
                } else if (recordedRows(values, 'comprobaciones').some(row => ['No', 'Pendiente'].includes(String(row.resultado))) ||
                    recordedRows(values, 'criterios-evidencia').some(row => row.resultado === 'Pendiente')) {
                    throw new Error('Las comprobaciones pendientes o negativas y los criterios sin verificar requieren mantener retenido el producto o documentar una liberación excepcional.');
                }
                if (recordedRows(values, 'criterios-evidencia').some(row => row.resultado === 'No cumple')) {
                    requireRecorded(values, ['concesion'], 'Una liberación que incluye un incumplimiento requiere la referencia de la concesión autorizada.');
                }
            }
            break;
        }
        case 'control-salidas-no-conformes':
            for (const row of recordedRows(values, 'disposiciones')) {
                requireClientDecision(row, 'autoriza-cliente', 'fecha-cliente', 'evidencia-cliente');
            }
            break;
        case 'requisicion-orden-externa':
            if (values.decision === 'Autorizada') {
                if (!['Aprobado', 'Condicionado'].includes(String(values['estado-proveedor']))) {
                    throw new Error('La orden solo puede autorizarse para un proveedor aprobado o condicionado para ese suministro.');
                }
                if (values['estado-proveedor'] === 'Condicionado') {
                    requireRecorded(values, ['controles-adicionales'], 'El proveedor condicionado requiere controles adicionales, fecha de cierre y autoridad.');
                }
                if (recordedRows(values, 'revision-previa-orden').some(row => !['Conforme para emitir', 'No aplica'].includes(String(row.resultado)))) {
                    throw new Error('Resuelve las revisiones previas antes de autorizar la emisión de la orden.');
                }
            }
            if (values.enviada === 'Sí') {
                if (values.decision !== 'Autorizada') throw new Error('La versión enviada debe contar con autorización de emisión. Conserva la situación pendiente como borrador.');
                requireRecorded(values, ['fecha-envio', 'enviado-por', 'destinatario', 'evidencia-envio'], 'El envío de la orden requiere fecha, emisor, destinatario y evidencia de la versión comunicada.');
            }
            if (values.confirmacion === 'Aceptada') {
                requireRecorded(values, ['fecha-confirmacion', 'evidencia-confirmacion'], 'La aceptación del proveedor requiere fecha y evidencia de su confirmación.');
            }
            break;
        case 'verificacion-suministro-externo': {
            const inspections = recordedRows(values, 'resultados');
            if (values.decision === 'Aceptado') {
                if (inspections.some(row => row.conformidad === 'Pendiente')) {
                    throw new Error('El suministro no puede aceptarse completo mientras tenga verificaciones pendientes.');
                }
                if (inspections.some(row => row.conformidad === 'No conforme')) {
                    requireRecorded(values, ['nc', 'concesion'], 'La aceptación de un suministro no conforme requiere no conformidad y concesión autorizada vinculadas.');
                }
            } else if (values.decision === 'Aceptación parcial autorizada' && inspections.some(row => row.conformidad === 'No conforme')) {
                requireRecorded(values, ['nc'], 'Vincula el control de la parte no conforme antes de registrar una aceptación parcial.');
            }
            break;
        }
    }
}

/** The persisted server schema is the authority; unknown keys are never stored. */
export function validateDigitalValues(template: DigitalTemplate, input: unknown, final: boolean): DigitalValues {
    readDigitalTemplate(template);
    if (!object(input) || Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_CAPTURE_BYTES) {
        throw new Error('La captura no es válida o excede el tamaño permitido.');
    }
    const allowed = new Set(template.sections.flatMap(s => [...(s.fields || []).map(f => f.key), ...(s.table ? [s.table.key] : [])]));
    for (const key of Object.keys(input)) if (!allowed.has(key) || FORBIDDEN_KEYS.has(key)) throw new Error(`Campo no reconocido: ${key}.`);
    const result: DigitalValues = {};
    for (const section of template.sections) {
        for (const field of section.fields || []) result[field.key] = fieldValue(field, input[field.key], final, field.label);
        if (!section.table) continue;
        const table = section.table;
        const rows = input[table.key] ?? table.initialRows ?? [];
        const expected = table.initialRows?.length ?? table.minRows ?? 1;
        if (!Array.isArray(rows) || rows.length > Math.min(table.maxRows ?? 200, 500) ||
            (table.fixedRows && rows.length !== expected) || (final && rows.length < (table.minRows ?? 0))) {
            throw new Error(`${table.label}: cantidad de filas no válida.`);
        }
        const allowedColumns = new Set(table.columns.map(c => c.key));
        if (final && !table.fixedRows && rows.filter(raw => object(raw) && Object.values(raw).some(v => !empty(v) && v !== false)).length < (table.minRows ?? 0)) {
            throw new Error(`${table.label}: completa al menos ${table.minRows} fila(s).`);
        }
        result[table.key] = rows.map((raw, index) => {
            if (!object(raw) || Object.keys(raw).some(key => !allowedColumns.has(key) || FORBIDDEN_KEYS.has(key))) {
                throw new Error(`${table.label}, fila ${index + 1}: campos no válidos.`);
            }
            const row: DigitalRow = {};
            const active = table.fixedRows || Object.values(raw).some(v => !empty(v) && v !== false);
            for (const field of table.columns) {
                const seed = table.initialRows?.[index]?.[field.key];
                if (field.readOnly && seed !== undefined && raw[field.key] !== undefined && String(raw[field.key]) !== String(seed)) {
                    throw new Error(`${table.label}: no se puede modificar ${field.label}.`);
                }
                row[field.key] = fieldValue(field, field.readOnly && seed !== undefined ? seed : raw[field.key], final && !!active,
                    `${field.label} (fila ${index + 1} de ${table.label})`);
            }
            return row;
        });
    }
    if (final) {
        const approvals = result.aprobaciones;
        if (Array.isArray(approvals)) for (const [index, row] of approvals.entries()) {
            if (row.requiere_aprobacion === 'Sí' && (!row.aprobador || !row.firma_aprobacion || !row.fecha_aprobacion)) {
                throw new Error(`Aprobaciones, fila ${index + 1}: indica el aprobador, la fecha y su firma.`);
            }
        }
        if (template.key === 'checklist-proveedor-potencial' && result.aprobado === 'Sí' &&
            (!result.aprobado_por || !result.firma_aprobacion || !result.fecha_aprobacion)) {
            throw new Error('La aprobación del proveedor requiere nombre, fecha y firma de quien aprueba.');
        }
        if (template.key === 'planeacion-presupuesto' && (!result.aprobado_por || !result.firma_aprobacion || !result.fecha_aprobacion)) {
            throw new Error('Completa el nombre, la fecha y la firma de aprobación del presupuesto.');
        }
        if (template.key === 'matriz-control-cambios' && (!result.autorizo || !result.firma_autorizo)) {
            throw new Error('Completa el nombre y la firma de quien autoriza el cambio.');
        }
        validateControlledFormDecisions(template, result);
    }
    return result;
}
