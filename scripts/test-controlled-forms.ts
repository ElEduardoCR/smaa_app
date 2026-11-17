/** Pure decision tests. Fixtures contain no company documents, staff, signatures
 * or operational records; no database or external service is contacted. */
import assert from 'node:assert/strict';
import type { DigitalField, DigitalTemplate, DigitalValues } from '../src/lib/documents/schema';
import { readDigitalTemplate, validateDigitalValues } from '../src/lib/documents/validation';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const DATE = '2026-11-17';
const field = (key: string): DigitalField => ({ key, label: key,
    type: key.startsWith('firma-') || key.endsWith('-firma') ? 'signature' : key.includes('fecha') ? 'date' : key.startsWith('cantidad-') ? 'number' : 'text' });
const signerKeys = (prefix: string) => [`${prefix}-nombre`, `${prefix}-fecha`, `${prefix}-firma`];
const signer = (prefix: string) => ({ [`${prefix}-nombre`]: 'Responsable QA', [`${prefix}-fecha`]: DATE, [`${prefix}-firma`]: PNG });
const clientKeys = (name: string, date: string, evidence: string) => ['requiere-cliente', name, date, evidence];
function fixture(key: string, fields: string[], tables: Record<string, string[]> = {}): DigitalTemplate {
    return { key, code: 'QA-F-01', title: 'Formato de prueba', kind: 'form', area: 'QA', priority: 1,
        sourceFiles: [], sourceIsExample: false, captureEnabled: true, description: 'Datos sintéticos aislados',
        sections: [{ title: 'Datos de prueba', fields: [...new Set(fields)].map(field) },
            ...Object.entries(tables).map(([name, columns]) => ({ title: name,
                table: { key: name, label: name, minRows: 0, columns: columns.map(field) } }))] };
}
const forms: Record<string, DigitalTemplate> = {
    'revision-requisitos-cliente': fixture('revision-requisitos-cliente', ['resultado', 'ubicacion-soportes', ...signerKeys('autoriza')], { comprobaciones: ['resultado'] }),
    'plan-por-pedido': fixture('plan-por-pedido', ['estado-plan', 'produccion-calidad', 'evidencia-entrega', 'facturacion']),
    'comunicacion-cambio-requisitos': fixture('comunicacion-cambio-requisitos', ['decision', 'tipo-evento', 'antes', 'despues', 'razon', 'documentos-cambio', ...signerKeys('autoridad'), ...clientKeys('confirma-cliente', 'fecha-cliente', 'evidencia-cliente')], { impactos: ['afectado'] }),
    'hoja-viajera-inspeccion': fixture('hoja-viajera-inspeccion', ['verificable-despues', 'evaluacion-validacion', 'metodo-validacion', 'resultados-validacion', 'aprobo-validacion', 'firma-validacion', 'fecha-validacion', 'revalidacion']),
    'propiedad-preservacion-entrega': fixture('propiedad-preservacion-entrega', ['estado-operativo', 'fecha-entrega', 'recibio', 'evidencia-recepcion', 'liberacion']),
    'cambios-produccion-postentrega': fixture('cambios-produccion-postentrega', ['decision', ...signerKeys('autoriza'), ...clientKeys('acepta-cliente', 'fecha-acepta-cliente', 'evidencia-acepta-cliente')], { 'revision-tecnica': ['afectado'] }),
    'liberacion-productos-servicios': fixture('liberacion-productos-servicios', ['decision', 'cantidad-autorizada', 'cantidad-revisada', 'motivo-excepcion', 'verificaciones-pendientes', 'restricciones', 'concesion', ...clientKeys('autoriza-cliente', 'fecha-cliente', 'evidencia-cliente')], { comprobaciones: ['resultado'], 'criterios-evidencia': ['resultado'] }),
    'control-salidas-no-conformes': fixture('control-salidas-no-conformes', [], { disposiciones: ['disposicion', ...clientKeys('autoriza-cliente', 'fecha-cliente', 'evidencia-cliente')] }),
    'requisicion-orden-externa': fixture('requisicion-orden-externa', ['decision', 'estado-proveedor', 'controles-adicionales', 'enviada', 'fecha-envio', 'enviado-por', 'destinatario', 'evidencia-envio', 'confirmacion', 'fecha-confirmacion', 'evidencia-confirmacion'], { 'revision-previa-orden': ['resultado'] }),
    'verificacion-suministro-externo': fixture('verificacion-suministro-externo', ['decision', 'nc', 'concesion'], { resultados: ['conformidad'] }),
};
let assertions = 0;
function accept(key: string, values: DigitalValues, final = true) {
    validateDigitalValues(forms[key], values, final);
    assertions++;
}
function reject(key: string, values: DigitalValues, pattern: RegExp) {
    assert.throws(() => validateDigitalValues(forms[key], values, true), pattern);
    // A failed finalization never prevents retaining the same partial draft.
    validateDigitalValues(forms[key], values, false);
    assertions += 2;
}

// Accepting a customer commitment is distinct from preserving an unresolved review.
reject('revision-requisitos-cliente', { resultado: 'Apto para comprometer' }, /autoridad interna/);
reject('revision-requisitos-cliente', { resultado: 'Apto para comprometer', ...signer('autoriza') }, /aceptación del cliente/);
const acceptedReview = { resultado: 'Apto para comprometer', ...signer('autoriza'), 'ubicacion-soportes': 'Expediente QA' };
accept('revision-requisitos-cliente', acceptedReview);
reject('revision-requisitos-cliente', { ...acceptedReview, comprobaciones: [{ resultado: 'Pendiente' }] }, /comprobación previa/);
reject('revision-requisitos-cliente', { ...acceptedReview, comprobaciones: [{ resultado: 'No' }] }, /comprobación previa/);
accept('revision-requisitos-cliente', { resultado: 'Pendiente', comprobaciones: [{ resultado: 'No' }] });

reject('plan-por-pedido', { 'estado-plan': 'Cerrado' }, /cierre del plan/);
accept('plan-por-pedido', { 'estado-plan': 'Cerrado', 'produccion-calidad': 'QA-PROD', 'evidencia-entrega': 'QA-ENT', facturacion: 'QA-FAC' });
accept('plan-por-pedido', { 'estado-plan': 'Abierto' });

reject('comunicacion-cambio-requisitos', { decision: 'Autorizado' }, /autoridad interna/);
const authorizedChange: DigitalValues = { decision: 'Autorizado', ...signer('autoridad'), 'requiere-cliente': 'No aplica' };
accept('comunicacion-cambio-requisitos', authorizedChange);
reject('comunicacion-cambio-requisitos', { ...authorizedChange, 'requiere-cliente': 'Pendiente' }, /Resuelve/);
reject('comunicacion-cambio-requisitos', { ...authorizedChange, 'requiere-cliente': 'Sí' }, /autorización del cliente/);
accept('comunicacion-cambio-requisitos', { ...authorizedChange, 'requiere-cliente': 'Sí', 'confirma-cliente': 'Contacto QA', 'fecha-cliente': DATE, 'evidencia-cliente': 'Confirmación QA' });
reject('comunicacion-cambio-requisitos', { ...authorizedChange, 'tipo-evento': 'Cambio de requisito' }, /requisito anterior/);
accept('comunicacion-cambio-requisitos', { ...authorizedChange, 'tipo-evento': 'Cambio de requisito', antes: 'Revisión A', despues: 'Revisión B', razon: 'Solicitud QA', 'documentos-cambio': 'QA-01' });
reject('comunicacion-cambio-requisitos', { ...authorizedChange, impactos: [{ afectado: 'Pendiente' }] }, /evaluación de impactos/);
accept('comunicacion-cambio-requisitos', { decision: 'Comunicación sin cambio de compromiso' });

reject('hoja-viajera-inspeccion', { 'verificable-despues': 'No' }, /documenta la validación/);
accept('hoja-viajera-inspeccion', { 'verificable-despues': 'No', 'evaluacion-validacion': 'Análisis QA', 'metodo-validacion': 'Método QA', 'resultados-validacion': 'Resultado QA', 'aprobo-validacion': 'Responsable QA', 'firma-validacion': PNG, 'fecha-validacion': DATE, revalidacion: 'Ante cambio autorizado' });
accept('hoja-viajera-inspeccion', { 'verificable-despues': 'Sí' });

reject('propiedad-preservacion-entrega', { 'estado-operativo': 'Entrega confirmada' }, /evidencia real/);
const receipt = { 'fecha-entrega': DATE, recibio: 'Receptor QA', 'evidencia-recepcion': 'Acuse QA' };
reject('propiedad-preservacion-entrega', { 'estado-operativo': 'Entrega confirmada', ...receipt }, /liberación de Calidad/);
accept('propiedad-preservacion-entrega', { 'estado-operativo': 'Entrega confirmada', ...receipt, liberacion: 'QA-LIB' });
// Returning a customer's tool does not imply manufacturing product release.
accept('propiedad-preservacion-entrega', { 'estado-operativo': 'Devolución confirmada', ...receipt });
accept('propiedad-preservacion-entrega', { 'estado-operativo': 'Abierta' });

reject('cambios-produccion-postentrega', { decision: 'Autorizado' }, /quien autoriza/);
const productionChange = { decision: 'Autorizado', ...signer('autoriza'), 'requiere-cliente': 'No' };
accept('cambios-produccion-postentrega', productionChange);
reject('cambios-produccion-postentrega', { ...productionChange, 'requiere-cliente': 'Sí' }, /autorización del cliente/);
accept('cambios-produccion-postentrega', { ...productionChange, 'requiere-cliente': 'Sí', 'acepta-cliente': 'Contacto QA', 'fecha-acepta-cliente': DATE, 'evidencia-acepta-cliente': 'Aceptación QA' });
reject('cambios-produccion-postentrega', { ...productionChange, 'revision-tecnica': [{ afectado: 'Pendiente' }] }, /revisión técnica/);
accept('cambios-produccion-postentrega', { decision: 'Pendiente' });

const release = { decision: 'Liberación normal', 'requiere-cliente': 'No', 'cantidad-revisada': 4, 'cantidad-autorizada': 4 };
accept('liberacion-productos-servicios', release);
reject('liberacion-productos-servicios', { ...release, 'cantidad-autorizada': 0 }, /cantidad liberada/);
reject('liberacion-productos-servicios', { ...release, 'cantidad-autorizada': 5 }, /cantidad liberada/);
reject('liberacion-productos-servicios', { ...release, 'requiere-cliente': 'Pendiente' }, /Resuelve/);
reject('liberacion-productos-servicios', { ...release, 'requiere-cliente': 'Sí' }, /autorización del cliente/);
accept('liberacion-productos-servicios', { ...release, 'requiere-cliente': 'Sí', 'autoriza-cliente': 'Contacto QA', 'fecha-cliente': DATE, 'evidencia-cliente': 'Autorización QA' });
reject('liberacion-productos-servicios', { ...release, comprobaciones: [{ resultado: 'Pendiente' }] }, /comprobaciones pendientes/);
reject('liberacion-productos-servicios', { ...release, comprobaciones: [{ resultado: 'No' }] }, /comprobaciones pendientes/);
reject('liberacion-productos-servicios', { ...release, 'criterios-evidencia': [{ resultado: 'Pendiente' }] }, /criterios sin verificar/);
reject('liberacion-productos-servicios', { ...release, decision: 'Liberación excepcional antes de completar verificaciones' }, /liberación excepcional requiere/);
accept('liberacion-productos-servicios', { ...release, decision: 'Liberación excepcional antes de completar verificaciones', 'motivo-excepcion': 'Motivo QA', 'verificaciones-pendientes': 'Verificación QA', restricciones: 'Alcance QA', comprobaciones: [{ resultado: 'Pendiente' }] });
accept('liberacion-productos-servicios', { ...release, decision: 'Liberación excepcional antes de completar verificaciones', 'motivo-excepcion': 'Motivo QA', 'verificaciones-pendientes': 'Verificación QA', restricciones: 'Alcance QA', 'criterios-evidencia': [{ resultado: 'Pendiente' }] });
reject('liberacion-productos-servicios', { ...release, 'criterios-evidencia': [{ resultado: 'No cumple' }] }, /concesión autorizada/);
accept('liberacion-productos-servicios', { ...release, concesion: 'QA-CONC', 'criterios-evidencia': [{ resultado: 'No cumple' }] });
accept('liberacion-productos-servicios', { decision: 'Retenido', comprobaciones: [{ resultado: 'Pendiente' }] });

reject('control-salidas-no-conformes', { disposiciones: [{ disposicion: 'Aceptación bajo concesión', 'requiere-cliente': 'Sí' }] }, /autorización del cliente/);
reject('control-salidas-no-conformes', { disposiciones: [{ disposicion: 'Corrección', 'requiere-cliente': 'Pendiente' }] }, /Resuelve/);
accept('control-salidas-no-conformes', { disposiciones: [{ disposicion: 'Aceptación bajo concesión', 'requiere-cliente': 'Sí', 'autoriza-cliente': 'Contacto QA', 'fecha-cliente': DATE, 'evidencia-cliente': 'Concesión QA' }] });
accept('control-salidas-no-conformes', { disposiciones: [{ disposicion: 'Corrección', 'requiere-cliente': 'No aplica' }] });

for (const state of ['Suspendido', 'No aprobado', 'Pendiente']) {
    reject('requisicion-orden-externa', { decision: 'Autorizada', 'estado-proveedor': state }, /proveedor aprobado o condicionado/);
}
const order = { decision: 'Autorizada', 'estado-proveedor': 'Aprobado' };
accept('requisicion-orden-externa', order);
reject('requisicion-orden-externa', { ...order, 'estado-proveedor': 'Condicionado' }, /controles adicionales/);
accept('requisicion-orden-externa', { ...order, 'estado-proveedor': 'Condicionado', 'controles-adicionales': 'Control fecha y autoridad QA' });
for (const result of ['Pendiente', 'No conforme']) {
    reject('requisicion-orden-externa', { ...order, 'revision-previa-orden': [{ resultado: result }] }, /revisiones previas/);
}
accept('requisicion-orden-externa', { ...order, 'revision-previa-orden': [{ resultado: 'Conforme para emitir' }, { resultado: 'No aplica' }] });
reject('requisicion-orden-externa', { decision: 'Pendiente', enviada: 'Sí' }, /autorización de emisión/);
reject('requisicion-orden-externa', { ...order, enviada: 'Sí' }, /envío de la orden/);
accept('requisicion-orden-externa', { ...order, enviada: 'Sí', 'fecha-envio': DATE, 'enviado-por': 'Emisor QA', destinatario: 'Destino QA', 'evidencia-envio': 'Versión QA' });
reject('requisicion-orden-externa', { confirmacion: 'Aceptada' }, /aceptación del proveedor/);
accept('requisicion-orden-externa', { confirmacion: 'Aceptada', 'fecha-confirmacion': DATE, 'evidencia-confirmacion': 'Confirmación QA' });
accept('requisicion-orden-externa', { decision: 'Pendiente', 'estado-proveedor': 'Pendiente', enviada: 'No' });

reject('verificacion-suministro-externo', { decision: 'Aceptado', resultados: [{ conformidad: 'Pendiente' }] }, /verificaciones pendientes/);
reject('verificacion-suministro-externo', { decision: 'Aceptado', resultados: [{ conformidad: 'No conforme' }] }, /concesión autorizada/);
accept('verificacion-suministro-externo', { decision: 'Aceptado', resultados: [{ conformidad: 'No conforme' }], nc: 'QA-NC', concesion: 'QA-CONC' });
accept('verificacion-suministro-externo', { decision: 'Aceptado', resultados: [{ conformidad: 'Conforme' }] });
reject('verificacion-suministro-externo', { decision: 'Aceptación parcial autorizada', resultados: [{ conformidad: 'No conforme' }] }, /parte no conforme/);
accept('verificacion-suministro-externo', { decision: 'Aceptación parcial autorizada', resultados: [{ conformidad: 'No conforme' }], nc: 'QA-NC' });
accept('verificacion-suministro-externo', { decision: 'Retenido', resultados: [{ conformidad: 'Pendiente' }] });

// Source paths are derived exclusively from their hash and remain in the private
// PDF bucket; template metadata cannot redirect signed downloads elsewhere.
const evidenceTemplate = { ...forms['plan-por-pedido'], captureEnabled: false,
    relatedCodes: ['QA-01'], sourceEvidence: [{ label: 'Evidencia QA', fileName: 'original-qa.pdf', sha256: 'a'.repeat(64), storagePath: `sources/${'a'.repeat(64)}.pdf` }] };
readDigitalTemplate(evidenceTemplate);
assert.throws(() => readDigitalTemplate({ ...evidenceTemplate, captureEnabled: 'false' }), /Modo de documento/);
assert.throws(() => readDigitalTemplate({ ...evidenceTemplate, relatedCodes: [42] }), /Referencias documentales/);
for (const path of ['../private.pdf', 'https://example.invalid/file.pdf', 'sources/another.pdf', `sources/${'b'.repeat(64)}.pdf`]) {
    assert.throws(() => readDigitalTemplate({ ...evidenceTemplate, sourceEvidence: [{ ...evidenceTemplate.sourceEvidence[0], storagePath: path }] }), /Evidencia de origen/);
}
for (const name of ['../original.pdf', 'folder\\original.pdf', 'original.docx']) {
    assert.throws(() => readDigitalTemplate({ ...evidenceTemplate, sourceEvidence: [{ ...evidenceTemplate.sourceEvidence[0], fileName: name }] }), /Evidencia de origen/);
}
assertions += 10;
console.log(`PASS: ${assertions} controlled-form checks; ten synthetic form schemas; partial drafts; approvals; client consent; exceptional releases; supplier state; dated evidence; private source paths.`);
