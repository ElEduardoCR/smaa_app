import type { DigitalField, DigitalRow, DigitalSection, DigitalTemplate } from './schema';

const f = (key: string, label: string, type: DigitalField['type'] = 'text', extra: Partial<DigitalField> = {}): DigitalField => ({ key, label, type, ...extra });
const choices = (key: string, label: string, options: string[], required = false) => f(key, label, 'select', { options, required });
const yesNo = ['Sí', 'No', 'No aplica'];
const signature = (key: string, label: string) => f(key, label, 'signature');
const rowsFrom = (labels: string[], key: string): DigitalRow[] => labels.map(label => ({ [key]: label }));
const ownerFields = [f('actualizado_por', 'Actualizado por', 'text', { required: true }), f('fecha_actualizacion', 'Fecha de actualización', 'date', { required: true })];
const approvalRows: DigitalField[] = [
    choices('requiere_aprobacion', 'Requiere aprobación', ['Sí', 'No'], true),
    f('generador', 'Generador de documentos'), f('aprobador', 'Nombre de quien aprueba'),
    signature('firma_aprobacion', 'Firma de aprobación'), f('fecha_aprobacion', 'Fecha de aprobación', 'date'),
    f('copias', 'Número de copias controladas', 'number', { min: 0 }),
    f('folios', 'Folios de copias'), f('recibido_por', 'Nombre de quien recibe'),
    signature('firma_recibido', 'Firma de recibido'), f('fecha_recibido', 'Fecha de recibido', 'date'),
];
const controllerChecklist = (labels: string[]): DigitalSection => ({
    title: 'Verificación del controlador de documentos',
    paragraphs: ['El controlador registra el resultado de cada comprobación. Use No aplica cuando la actividad corresponda únicamente a copias físicas que no se emiten.'],
    table: {
        key: 'verificacion_controlador', label: 'Comprobaciones', fixedRows: true,
        columns: [f('comprobacion', 'Comprobación', 'text', { readOnly: true }), choices('resultado', 'Resultado', yesNo), f('observaciones', 'Observaciones')],
        initialRows: rowsFrom(labels, 'comprobacion'),
    },
});
const auditIdentity: DigitalSection = {
    title: 'Identificación de auditoría',
    fields: [f('numero_auditoria', 'Número de auditoría', 'text', { required: true }), f('fecha', 'Fecha', 'date', { required: true })],
};
const auditSignatures: DigitalSection = {
    title: 'Responsables',
    fields: [f('auditor_lider', 'Auditor líder'), signature('firma_auditor_lider', 'Firma del auditor líder'), f('coordinador_iso', 'Coordinador ISO'), signature('firma_coordinador_iso', 'Firma del coordinador ISO')],
};
const findingColumns = [
    f('mayor', 'Mayores', 'number', { min: 0 }), f('menor', 'Menores', 'number', { min: 0 }),
    f('observacion', 'Observaciones', 'number', { min: 0 }), f('mejora', 'Oportunidades de mejora', 'number', { min: 0 }),
];

const requirementRows: DigitalRow[] = [
    ['4', 'Contexto de la organización'], ['4.1', 'Comprensión de la organización y de su contexto'],
    ['4.2', 'Comprensión de las necesidades y expectativas de las partes interesadas'],
    ['4.3', 'Determinación del alcance del sistema de gestión de la calidad'], ['4.4', 'Sistema de gestión de la calidad y sus procesos'],
    ['5', 'Liderazgo'], ['5.1', 'Liderazgo y compromiso'], ['5.1.1', 'Generalidades'], ['5.1.2', 'Enfoque al cliente'],
    ['5.2', 'Política'], ['5.2.1', 'Establecimiento de la política de la calidad'], ['5.2.2', 'Comunicación de la política de la calidad'],
    ['5.3', 'Roles, responsabilidades y autoridades en la organización'],
    ['6', 'Planificación'], ['6.1', 'Acciones para abordar riesgos y oportunidades'],
    ['6.2', 'Objetivos de la calidad y planificación para lograrlos'], ['6.3', 'Planificación de los cambios'],
    ['7', 'Apoyo'], ['7.1', 'Recursos'], ['7.1.1', 'Generalidades'], ['7.1.2', 'Personas'], ['7.1.3', 'Infraestructura'],
    ['7.1.4', 'Ambiente para la operación de los procesos'], ['7.1.5', 'Recursos de seguimiento y medición'],
    ['7.1.5.1', 'Generalidades'], ['7.1.5.2', 'Trazabilidad de las mediciones'], ['7.1.6', 'Conocimientos de la organización'],
    ['7.2', 'Competencia'], ['7.3', 'Toma de conciencia'], ['7.4', 'Comunicación'], ['7.5', 'Información documentada'],
    ['7.5.1', 'Generalidades'], ['7.5.2', 'Creación y actualización'], ['7.5.3', 'Control de la información documentada'],
    ['8', 'Operación'], ['8.1', 'Planificación y control operacional'], ['8.2', 'Requisitos para los productos y servicios'],
    ['8.2.1', 'Comunicación con el cliente'], ['8.2.2', 'Determinación de los requisitos para los productos y servicios'],
    ['8.2.3', 'Revisión de los requisitos para los productos y servicios'], ['8.2.4', 'Cambios en los requisitos para los productos y servicios'],
    ['8.3', 'Diseño y desarrollo de los productos y servicios'], ['8.4', 'Control de los procesos, productos y servicios suministrados externamente'],
    ['8.4.1', 'Generalidades'], ['8.4.2', 'Tipo y alcance del control'], ['8.4.3', 'Información para los proveedores externos'],
    ['8.5', 'Producción y provisión del servicio'], ['8.5.1', 'Control de la producción y de la provisión del servicio'],
    ['8.5.2', 'Identificación y trazabilidad'], ['8.5.3', 'Propiedad perteneciente a los clientes o proveedores externos'],
    ['8.5.4', 'Preservación'], ['8.5.5', 'Actividades posteriores a la entrega'], ['8.5.6', 'Control de los cambios'],
    ['8.6', 'Liberación de los productos y servicios'], ['8.7', 'Control de las salidas no conformes'],
    ['9', 'Evaluación del desempeño'], ['9.1', 'Seguimiento, medición, análisis y evaluación'], ['9.1.1', 'Generalidades'],
    ['9.1.2', 'Satisfacción del cliente'], ['9.1.3', 'Análisis y evaluación'], ['9.2', 'Auditoría interna'],
    ['9.3', 'Revisión por la dirección'], ['9.3.1', 'Generalidades'], ['9.3.2', 'Entradas de la revisión por la dirección'], ['9.3.3', 'Salidas de la revisión por la dirección'],
    ['10', 'Mejora'], ['10.1', 'Generalidades'], ['10.2', 'No conformidad y acción correctiva'], ['10.3', 'Mejora continua'],
].map(([clausula, requisito]) => ({ clausula, requisito }));

const months = [
    ['ene', 'Enero'], ['feb', 'Febrero'], ['mar', 'Marzo'], ['abr', 'Abril'], ['may', 'Mayo'], ['jun', 'Junio'],
    ['jul', 'Julio'], ['ago', 'Agosto'], ['sep', 'Septiembre'], ['oct', 'Octubre'], ['nov', 'Noviembre'], ['dic', 'Diciembre'],
];
const budgetMonthColumns: DigitalField[] = months.flatMap(([key, label]) => [
    f(`${key}_programado`, `${label} programado`, 'number'), f(`${key}_real`, `${label} real`, 'number'),
]);
const supplierRequirements = [
    'RFC y constancia de situación fiscal', 'Giro de la empresa', 'Materiales y marcas que maneja', 'Horario de la empresa',
    'Representante legal', 'Encargado de ventas', 'Antigüedad de la empresa', 'Sucursales', 'Banco', 'Número de cuenta y CLABE interbancaria',
    'Catálogo de los tres clientes más importantes', 'Certificado de calidad, si ofrece', 'Currículum para personas físicas',
    'Cotización con costo y tiempo de entrega', 'Certificado ISO 9001, si cuenta con él', 'Registro patronal',
    'Alta de seguros de trabajadores que laborarán dentro de SMAA S.A. de C.V.', 'Constancias de competencias del personal', 'Permisos y licencias', 'Otros requisitos',
];
const budgetCategoryLabels = [
    ['1.1', 'Recursos humanos', 'Reclutamiento'], ['1.2', 'Recursos humanos', 'Análisis clínicos'], ['1.3', 'Recursos humanos', 'Certificados médicos'],
    ['1.4', 'Recursos humanos', 'Estudios médicos'], ['1.5', 'Recursos humanos', 'Trámites de documentos'], ['1.6', 'Recursos humanos', 'Transporte de personal'],
    ['1.7', 'Recursos humanos', 'Uniformes'], ['1.8', 'Recursos humanos', 'Chamarras'], ['1.9', 'Recursos humanos', 'Calzado'],
    ['1.10', 'Recursos humanos', 'Eventos festivos'], ['1.11', 'Recursos humanos', 'Regalos de cumpleaños'], ['1.12', 'Recursos humanos', 'Capacitaciones'],
    ['1.13', 'Recursos humanos', 'Papelería'], ['1.14', 'Recursos humanos', 'Nómina administrativa'], ['1.15', 'Recursos humanos', 'Bonos administrativos'],
    ['1.16', 'Recursos humanos', 'Línea de atención'], ['1.17', 'Recursos humanos', 'Consultoría legal'], ['1.18', 'Recursos humanos', 'Transporte de personal'],
    ['1.19', 'Recursos humanos', 'Marketing de contenido'],
    ['2.1', 'Salud ocupacional', 'Medicamentos'], ['2.2', 'Salud ocupacional', 'Equipo para chequeos rápidos'], ['2.3', 'Salud ocupacional', 'Guantes'],
    ['2.4', 'Salud ocupacional', 'Certificados médicos'], ['2.5', 'Salud ocupacional', 'Pruebas y cartillas COVID'],
    ['3.1', 'Operación', 'Nómina operativa'], ['3.2', 'Operación', 'Bonos de productividad'], ['3.3', 'Operación', 'Insumos'],
    ['3.4', 'Operación', 'Combustible'], ['3.5', 'Operación', 'Renta de vehículos'], ['3.6', 'Operación', 'Equipo y herramientas'],
    ['3.7', 'Operación', 'Equipo de cómputo'], ['3.8', 'Operación', 'Servicio de red'], ['3.9', 'Operación', 'Equipo de radiofrecuencia'],
    ['3.10', 'Operación', 'Mobiliario de oficinas'], ['3.11', 'Operación', 'Material de construcción'], ['3.12', 'Operación', 'Refacciones'],
    ['4.1', 'Seguridad e higiene', 'Equipo de protección personal'], ['4.2', 'Seguridad e higiene', 'Equipo y herramientas'],
    ['4.3', 'Seguridad e higiene', 'Arnés de seguridad'], ['4.4', 'Seguridad e higiene', 'Señalización vial'],
    ['5.1', 'Administración', 'Consultoría contable'], ['5.2', 'Administración', 'Sistemas contables, facturación y nómina'],
    ['5.3', 'Administración', 'Mantenimiento de equipo de cómputo'], ['5.4', 'Administración', 'Papelería'],
    ['5.5', 'Administración', 'Servicio de red'], ['5.6', 'Administración', 'Gastos fijos del edificio'],
    ['6.1', 'Impuestos', 'IVA'], ['6.2', 'Impuestos', 'ISR'], ['6.3', 'Impuestos', 'ISN'], ['6.4', 'Impuestos', 'Cuotas IMSS e INFONAVIT'],
];

export const spreadsheetTemplates: DigitalTemplate[] = [
    {
        key: 'listado-maestro-documentos', code: 'ISO-F-01', title: 'Listado maestro de documentos', kind: 'register', area: 'ISO', priority: 1,
        sourceFiles: ['ISO-F-XX Listado Maestro de Documentos.xlsx'], sourceIsExample: false,
        description: 'Catálogo de documentos controlados de SMAA S.A. de C.V., responsables, revisión vigente y distribución de copias.',
        sections: [
            { title: 'Control del listado', fields: ownerFields },
            { title: 'Documentos controlados', table: { key: 'documentos', label: 'Listado maestro', minRows: 1, columns: [
                f('codigo', 'Código', 'text', { required: true }), f('nombre', 'Nombre del documento', 'text', { required: true }),
                f('responsable', 'Responsable'), f('revision', 'Revisión actual'), f('fecha_revision', 'Fecha de revisión', 'date'),
            ] } },
            { title: 'Copias controladas asignadas', paragraphs: ['Registre la distribución por área de SMAA S.A. de C.V. y conserve la relación con el código del documento.'], table: {
                key: 'copias_controladas', label: 'Distribución de copias', minRows: 0, columns: [
                    f('codigo_documento', 'Código de documento'), f('area', 'Área receptora'), f('responsable', 'Responsable de copia'),
                    f('cantidad', 'Cantidad de copias', 'number', { min: 0 }), f('folios', 'Folios'), choices('medio', 'Medio', ['Electrónico', 'Físico', 'Ambos']),
                ],
            } },
        ],
    },
    {
        key: 'listado-maestro-registros', code: 'ISO-F-02', title: 'Listado maestro de registros', kind: 'register', area: 'ISO', priority: 2,
        sourceFiles: ['ISO-F-XX Listado Maestro de Registros.xlsx'], sourceIsExample: false,
        description: 'Identificación, conservación y disposición de los registros del sistema de gestión de la calidad de SMAA S.A. de C.V.',
        sections: [
            { title: 'Control del listado', fields: ownerFields },
            { title: 'Registros por área', table: { key: 'registros', label: 'Listado de registros', minRows: 1, columns: [
                f('codigo', 'Número o código del registro', 'text', { required: true }), f('area', 'Área o función responsable'), f('nombre', 'Nombre del registro', 'text', { required: true }),
                f('revision', 'Revisión'), f('fecha_revision', 'Fecha de revisión', 'date'), f('retencion_meses', 'Retención mínima en meses', 'number', { min: 0 }),
                choices('regla_retencion', 'Regla de conservación', ['Por meses', 'Hasta cambio del documento', 'Siempre', 'Hasta incorporar cambios sugeridos', 'Hasta disposición del archivo muerto', 'Permanente en expediente personal', 'Junto al documento hasta su cancelación']),
                choices('medio', 'Medio', ['Electrónico', 'Físico', 'Ambos']), f('responsable_disposicion', 'Responsable de disposición'), f('codigos_pendientes', 'Códigos pendientes de otorgar'),
            ] } },
            { title: 'Criterios de conservación', paragraphs: [
                'La retención se define para cada registro. Puede expresarse en meses o mediante una condición de conservación; no se asigna un plazo por defecto.',
                'El índice de revisiones acompaña al documento hasta su cancelación. Los cambios propuestos a futuro se conservan hasta que se incorporan a una nueva revisión.',
                'Los registros electrónicos mantienen su identificación y se conservan en medio electrónico. La disposición corresponde al responsable indicado.',
            ] },
        ],
    },
    {
        key: 'registro-documento-nuevo', code: 'ISO-F-03', title: 'Registro de documento nuevo RDN', kind: 'form', area: 'ISO', priority: 3,
        sourceFiles: ['ISO-F-XX Registro de documento nuevo RDN.xlsx'], sourceIsExample: false,
        description: 'Alta controlada de un documento nuevo, sus aprobaciones, distribución y registros anexos.',
        sections: [
            { title: 'Origen del documento', fields: [
                f('fecha_origen', 'Fecha de origen del RDN', 'date', { required: true }), f('fecha_revision', 'Fecha de revisión del documento', 'date'),
                f('codigo_documento', 'Número o código del documento', 'text', { required: true }), f('nombre_documento', 'Nombre del documento', 'text', { required: true }),
                f('revision_documento', 'Número de revisión', 'text', { required: true }), f('departamento_originador', 'Departamento originador', 'text', { required: true }), f('originado_por', 'Originado por', 'text', { required: true }),
            ] },
            { title: 'Aprobaciones y entrega de copias controladas', table: { key: 'aprobaciones', label: 'Aprobadores y distribución', minRows: 1, columns: approvalRows } },
            { title: 'Documentos y registros anexos', paragraphs: ['Incluya cada formato o registro que se da de alta con este documento.'], table: { key: 'anexos', label: 'Anexos', minRows: 0, columns: [
                f('codigo', 'Número o código'), f('revision', 'Revisión'), f('nombre', 'Nombre del documento o registro'), f('responsable', 'Responsable'),
                choices('medio', 'Medio', ['Electrónico', 'Físico', 'Ambos']), f('retencion', 'Tiempo o condición de retención'), f('responsable_disposicion', 'Responsable de disposición'),
            ] } },
            controllerChecklist([
                'Documento firmado y RDN completo', 'Archivo electrónico y minutas entregados', 'Documento original sellado, si aplica',
                'Copias controladas selladas, si se requieren', 'Índice de revisiones abierto', 'Alta realizada en el listado maestro correspondiente',
                'Documentos archivados en la carpeta adecuada', 'Archivo electrónico actualizado en la app o red', 'Códigos de documentos referenciados revisados',
                'Conversión a PDF realizada', 'Alta comunicada a los usuarios involucrados', 'Actividades del procedimiento vigente de control documental verificadas, si es un proceso nuevo',
            ]),
            { title: 'Entrega e implementación', fields: [
                f('entregado_por', 'Entregado por el usuario'), signature('firma_entrega', 'Firma de entrega'), f('recibido_por_controlador', 'Recibido por control de documentos'),
                signature('firma_controlador', 'Firma de recibido del controlador'), f('fecha_recibido', 'Fecha de recibido', 'date'), f('fecha_implementacion', 'Fecha para implementación', 'date'),
            ] },
        ],
    },
    {
        key: 'requisicion-cambio-documento', code: 'ISO-F-04', title: 'Requisición de cambio de documento RCD', kind: 'form', area: 'ISO', priority: 4,
        sourceFiles: ['ISO-F-XX Requisicion de cambio de documento RCD.xlsx'], sourceIsExample: false,
        description: 'Solicitud y aprobación de cambios documentales, control de revisiones y sustitución de copias.',
        sections: [
            { title: 'Identificación de la requisición', fields: [
                f('folio_rcd', 'Folio de RCD'), f('fecha_rcd', 'Fecha de RCD', 'date', { required: true }), f('codigo_documento', 'Número o código del documento', 'text', { required: true }),
                f('nombre_documento', 'Nombre del documento', 'text', { required: true }), f('nueva_revision', 'Nueva revisión', 'text', { required: true }),
                f('solicitado_por', 'Cambio requerido por', 'text', { required: true }), f('razon_cambio', 'Razón del cambio', 'textarea', { required: true }),
            ] },
            { title: 'Descripción de los cambios', fields: [f('antes', 'Antes', 'textarea', { required: true }), f('despues', 'Después', 'textarea', { required: true })] },
            { title: 'Aprobaciones y entrega de copias controladas', table: { key: 'aprobaciones', label: 'Aprobaciones y copias', minRows: 1, columns: [
                ...approvalRows.filter(field => field.key !== 'folios'), f('folios_anteriores', 'Folios anteriores'), f('folios_nuevos', 'Folios nuevos'),
            ] } },
            controllerChecklist([
                'Documento firmado y RCD completo', 'Minuta de trabajo entregada', 'Documento original sellado, si aplica',
                'Documento reemplazado enviado a obsoletos', 'Copias controladas entregadas y copias obsoletas retiradas, si aplica',
                'Listado maestro correspondiente actualizado', 'Documentos archivados en la carpeta adecuada', 'Archivo electrónico actualizado en la app o red',
                'Cambio comunicado a los involucrados', 'Códigos de nuevos documentos o formatos referenciados revisados', 'Índice de revisiones actualizado',
                'Conversión a PDF realizada', 'Fecha y número de revisión verificados',
            ]),
            { title: 'Recepción e implementación', fields: [
                f('controlador', 'Controlador de documentos'), f('fecha_recibido_controlador', 'Fecha de recibido', 'date'), signature('firma_controlador', 'Firma del controlador'),
                f('fecha_implementacion', 'Fecha de implementación', 'date'), choices('es_cancelacion', '¿Es cancelación de documento?', ['Sí', 'No']),
                choices('actividades_cancelacion', 'Actividades del procedimiento vigente de cancelación realizadas', yesNo), f('observaciones_cancelacion', 'Observaciones de cancelación', 'textarea'),
            ] },
        ],
    },
    {
        key: 'indice-revisiones', code: 'ISO-F-05', title: 'Índice de revisiones', kind: 'register', area: 'ISO', priority: 5,
        sourceFiles: ['ISO-F-XX Indice de revisiones.xlsx'], sourceIsExample: false,
        description: 'Historial de revisión de cada documento controlado y relación con su requisición de cambio.',
        sections: [
            { title: 'Documento controlado', fields: [f('codigo_documento', 'Número o código del documento', 'text', { required: true }), f('nombre_documento', 'Nombre del documento', 'text', { required: true })] },
            { title: 'Historial de revisiones', table: { key: 'revisiones', label: 'Revisiones', minRows: 1, columns: [
                f('revision', 'Número de revisión', 'text', { required: true }), f('fecha_revision', 'Fecha de revisión', 'date', { required: true }), f('rcd', 'Folio de RCD'), f('cambios', 'Cambios realizados', 'textarea'),
            ] } },
            { title: 'Actualización del índice', fields: [f('controlador', 'Actualizado por el controlador de documentos'), signature('firma_controlador', 'Firma del controlador de documentos')] },
        ],
    },
    {
        key: 'matriz-control-cambios', code: 'ISO-F-06', title: 'Matriz de control de cambios en procesos', kind: 'form', area: 'ISO', priority: 6,
        sourceFiles: ['ISO-F-XX Matriz de control de cambios.xlsx'], sourceIsExample: false,
        description: 'Evaluación y seguimiento de cambios de procesos que pueden afectar la integridad del sistema de gestión de la calidad.',
        sections: [
            { title: 'Control de la matriz', paragraphs: ['Evalúe las implicaciones del cambio antes de autorizarlo. Registre riesgos, recursos, partes interesadas y documentación afectada para mantener la trazabilidad del proceso.'], fields: ownerFields },
            { title: 'Cambios propuestos', table: { key: 'cambios', label: 'Cambios y evaluación de impacto', minRows: 1, columns: [
                f('numero', 'Número de cambio'), f('fecha_solicitud', 'Fecha de solicitud', 'date', { required: true }), f('proceso', 'Proceso', 'text', { required: true }),
                f('descripcion', 'Cambio involucrado', 'textarea', { required: true }), f('solicitante', 'Área y responsable solicitante'), f('proposito', 'Propósito', 'textarea'),
                f('beneficios', 'Beneficios esperados', 'textarea'), f('recursos_financieros', 'Recursos financieros requeridos'), f('capacitacion', 'Capacitación requerida'),
                f('personal', 'Personal requerido'), f('recursos_fisicos', 'Recursos físicos'), f('otros_recursos', 'Otros recursos'),
                choices('amef', 'Presenta AMEF o evaluación de riesgos de calidad', yesNo), f('referencia_riesgos', 'Referencia de AMEF o evaluación de riesgos'),
                f('partes_interesadas', 'Partes interesadas impactadas', 'textarea'), f('documentacion_sgc', 'Documentación del SGC a actualizar', 'textarea'),
                f('nivel_impacto', 'Nivel de impacto y criterio aplicado'), f('fecha_termino', 'Fecha de término', 'date'),
            ] } },
            { title: 'Cronograma y seguimiento', paragraphs: ['Registre fechas completas para los hitos del cambio. Una reprogramación conserva la fecha original y la nueva fecha.'], table: { key: 'cronograma', label: 'Actividades y fechas', minRows: 1, columns: [
                f('numero_cambio', 'Número de cambio'), f('actividad', 'Actividad'), f('responsable', 'Responsable'), f('fecha_programada', 'Fecha programada', 'date'),
                f('fecha_reprogramada', 'Fecha reprogramada', 'date'), choices('estado', 'Estado', ['Cumplida', 'En proceso', 'Reprogramada']), f('fecha_cumplimiento', 'Fecha de cumplimiento', 'date'), f('observaciones', 'Observaciones'),
            ] } },
            { title: 'Cierre y autorización', fields: [
                f('elaboro', 'Elaboró'), signature('firma_elaboro', 'Firma de quien elaboró'), f('reviso', 'Revisó'), signature('firma_reviso', 'Firma de revisión'),
                f('autorizo', 'Autorizó'), signature('firma_autorizo', 'Firma de autorización'), f('fecha_cierre', 'Fecha de cierre', 'date'), f('conclusion', 'Conclusión del cierre', 'textarea'),
            ] },
        ],
    },
    {
        key: 'resultados-auditoria-requisitos', code: 'ISO-F-11', title: 'Resultados de auditoría por requisitos', kind: 'form', area: 'ISO', priority: 11,
        sourceFiles: ['ISO-F-XX Resultados de auditoria por requisitos.xlsx'], sourceIsExample: false,
        description: 'Concentrado de hallazgos de auditoría por requisito de ISO 9001:2015.',
        sections: [auditIdentity, {
            title: 'Hallazgos por requisito', paragraphs: ['Registre cada hallazgo una sola vez en el requisito más específico que corresponda. Use una fila general únicamente cuando el hallazgo no esté asignado a un requisito de mayor detalle. Las cantidades se suman sin repetir subtotales.'],
            table: { key: 'hallazgos', label: 'Requisitos y categorías de hallazgo', fixedRows: true, columns: [f('clausula', 'Cláusula', 'text', { readOnly: true }), f('requisito', 'Requisito', 'text', { readOnly: true }), ...findingColumns], initialRows: requirementRows },
        }, auditSignatures],
    },
    {
        key: 'resultados-auditoria-procesos', code: 'ISO-F-12', title: 'Resultados de auditoría por procesos', kind: 'form', area: 'ISO', priority: 12,
        sourceFiles: ['ISO-F-XX Resultados de auditoria por procesos.xlsx'], sourceIsExample: false,
        description: 'Concentrado de hallazgos por documento y proceso auditado de SMAA S.A. de C.V.',
        sections: [auditIdentity, {
            title: 'Hallazgos por proceso', table: { key: 'hallazgos', label: 'Hallazgos y categorías', minRows: 1, columns: [
                f('documento', 'Documento'), f('proceso', 'Proceso', 'text', { required: true }), ...findingColumns,
            ] },
        }, auditSignatures],
    },
    {
        key: 'encuesta-satisfaccion-cliente', code: 'ISO-F-14', title: 'Encuesta de satisfacción del cliente', kind: 'form', area: 'ISO', priority: 14,
        sourceFiles: ['ISO-F-XX Ejemplo - Encuesta de satisfacción del cliente.xlsx'], sourceIsExample: true, needsAdaptation: true,
        description: 'Captura interna de la opinión del cliente sobre los productos y servicios de SMAA S.A. de C.V.',
        sections: [
            { title: 'Datos de la captura', paragraphs: ['Ayúdenos a conocer su grado de satisfacción con los productos y servicios de SMAA S.A. de C.V. Los datos generales se utilizan para análisis interno.'], fields: [
                f('fecha', 'Fecha de la encuesta', 'date', { required: true }), f('capturado_por', 'Capturado por', 'text', { required: true }), f('cliente_referencia', 'Cliente o referencia de atención, si se proporciona'),
            ] },
            { title: 'Datos generales', fields: [
                choices('genero', 'Género', ['Masculino', 'Femenino', 'Otro', 'Prefiere no responder']), f('genero_otro', 'Otro género, si desea especificar'),
                choices('edad', 'Grupo de edad', ['18 a 30', '31 a 45', '46 a 60', '61 o más', 'Prefiere no responder']),
                choices('puesto', 'Puesto', ['Comprador', 'Coordinador de área', 'Jefe de departamento', 'Director', 'Gerente', 'Otro']), f('puesto_otro', 'Otro puesto'),
            ] },
            { title: 'Producto o servicio recibido', fields: [f('producto_servicio', 'Producto o servicio de SMAA recibido', 'textarea', { required: true })] },
            { title: 'Evaluación del servicio', paragraphs: ['Califique cada aspecto del 1 al 5: 1 = Muy insatisfecho, 3 = Regular, 5 = Muy satisfecho.'], table: {
                key: 'evaluaciones', label: 'Calificación por aspecto', fixedRows: true,
                columns: [f('aspecto', 'Aspecto evaluado', 'text', { readOnly: true }), choices('calificacion', 'Calificación de 1 a 5', ['1', '2', '3', '4', '5'], true)],
                initialRows: rowsFrom(['Calidad general del servicio recibido', 'Tiempos de atención y respuesta', 'Claridad de la información proporcionada', 'Trato y profesionalismo del personal', 'Facilidad para realizar pedidos y compras', 'Cumplimiento con lo solicitado'], 'aspecto'),
            } },
            { title: 'Comentarios y sugerencias', fields: [f('mejoras', '¿Qué aspecto de nuestros productos o servicios considera que se puede mejorar?', 'textarea'), f('comentarios', '¿Tiene algún comentario adicional o sugerencia?', 'textarea')] },
            { title: 'Aviso de privacidad', paragraphs: ['Pendiente incorporar el aviso de privacidad autorizado de SMAA S.A. de C.V. El archivo de referencia no contiene un aviso utilizable.'], fields: [
                f('aviso_privacidad', 'Aviso de privacidad autorizado', 'textarea', { placeholder: 'Incorporar el texto autorizado antes de recabar datos personales.' }),
            ] },
        ],
    },
    {
        key: 'deteccion-necesidades-capacitacion', code: 'RHU-F-01', title: 'Detección de necesidades de capacitación DNC', kind: 'form', area: 'Recursos humanos', priority: 1,
        sourceFiles: ['RHU-F-XX Ejemplo - Detección de Necesidades de Capacitación (DNC).xlsx'], sourceIsExample: true,
        description: 'Detección de necesidades por persona, puesto o departamento de SMAA S.A. de C.V.',
        sections: [
            { title: 'Identificación de la detección', fields: [
                choices('modalidad', 'DNC por', ['Persona', 'Puesto', 'Departamento'], true), f('realizado_por', 'Realizado por', 'text', { required: true }),
                f('departamento', 'Departamento', 'text', { required: true }), f('persona_puesto', 'Nombre de persona o puesto'), f('fecha_elaboracion', 'Fecha de elaboración', 'date', { required: true }),
            ] },
            { title: 'Cursos detectados', table: { key: 'cursos', label: 'Necesidades de capacitación', minRows: 1, columns: [
                f('numero', 'Número'), f('curso', 'Nombre del curso detectado', 'text', { required: true }), f('objetivo', 'Objetivo del curso', 'textarea'),
                f('objetivo_estrategico', 'Objetivo estratégico o del puesto a impactar', 'textarea'),
                choices('fuente', 'Fuente de DNC', ['I Perfil de puestos y competencias', 'II Objetivos estratégicos y del puesto', 'III Quejas de cliente', 'IV Encuestas de satisfacción del cliente', 'V Encuestas de ambiente laboral', 'VI Encuestas de 360', 'VII Proceso de inducción', 'VIII Procesos nuevos', 'IX Cambios en normatividad', 'X Riesgos y oportunidades']),
                f('duracion', 'Duración estimada del curso en horas', 'number', { min: 0 }), choices('prioridad', 'Prioridad', ['A Urgente antes de 3 meses', 'B Normal después de 3 meses']),
            ] } },
            { title: 'Personas o puestos que requieren el curso', paragraphs: ['Para la detección por puesto, identifique por curso cada persona o puesto evaluado y registre si requiere la capacitación.'], table: { key: 'participantes', label: 'Personal o puestos evaluados', minRows: 0, columns: [
                f('numero_curso', 'Número de curso'), f('nombre_puesto', 'Nombre o puesto'), choices('requiere', 'Requiere capacitación', ['Sí', 'No']), f('observaciones', 'Observaciones'),
            ] } },
            { title: 'Criterio de prioridad', paragraphs: ['A corresponde a una necesidad urgente que debe atenderse antes de tres meses. B corresponde a una necesidad normal prevista después de tres meses. La fecha de programación se determina al preparar el plan de capacitación.'] },
        ],
    },
    {
        key: 'planeacion-presupuesto', code: 'GAD-F-01', title: 'Planeación de presupuesto', kind: 'form', area: 'Administración y finanzas', priority: 1,
        sourceFiles: ['Ejemplo - GAD-F-XX Planeación de Presupuesto.xlsx'], sourceIsExample: true,
        description: 'Presupuesto anual de SMAA S.A. de C.V. por objetivo, programa, componente y actividad, con seguimiento programado y real.',
        sections: [
            { title: 'Ejercicio presupuestal', fields: [
                f('ejercicio', 'Ejercicio fiscal', 'number', { required: true, min: 2000, max: 2200 }), choices('moneda', 'Moneda', ['MXN', 'USD'], true),
                choices('tratamiento_iva', 'Tratamiento de IVA', ['Importes sin IVA', 'Importes con IVA', 'No aplica'], true),
                f('elaborado_por', 'Elaborado por', 'text', { required: true }), f('fecha_actualizacion', 'Fecha de actualización', 'date', { required: true }),
            ] },
            { title: 'Objetivos y programas', table: { key: 'objetivos_programas', label: 'Fin y propósito', minRows: 1, columns: [
                f('id_objetivo', 'ID de objetivo'), f('objetivo', 'Descripción del objetivo estratégico', 'textarea'), f('id_programa', 'ID de programa'),
                f('programa', 'Nombre del programa u objetivo específico'), f('objetivo_especifico', 'Descripción del objetivo específico', 'textarea'),
            ] } },
            { title: 'Programación y gasto real por actividad', paragraphs: [
                'Capture manualmente los importes programados y reales de cada mes. Relacione cada actividad con un objetivo, programa y componente.',
                'Los totales anuales suman los doce meses. El porcentaje de ejercicio compara el gasto real con el programado. Un presupuesto igual a cero no produce un porcentaje válido.',
            ], table: { key: 'presupuesto', label: 'Presupuesto por actividad y mes', minRows: 1, columns: [
                f('id_objetivo', 'ID de objetivo'), f('id_programa', 'ID de programa'), f('id_componente', 'ID de componente'), f('componente', 'Componente'),
                f('id_actividad', 'ID de línea de acción'), f('actividad', 'Actividad o partida', 'text', { required: true }), f('descripcion', 'Descripción de la actividad'), ...budgetMonthColumns,
            ] } },
            { title: 'Aprobación del presupuesto', fields: [f('aprobado_por', 'Aprobado por'), signature('firma_aprobacion', 'Firma de aprobación'), f('fecha_aprobacion', 'Fecha de aprobación', 'date'), f('observaciones', 'Observaciones', 'textarea')] },
        ],
    },
    {
        key: 'partidas-presupuesto', code: 'GAD-F-02', title: 'Catálogo de partidas de presupuesto', kind: 'register', area: 'Administración y finanzas', priority: 2,
        sourceFiles: ['Ejemplo - Partidas presupuesto.xlsx'], sourceIsExample: true,
        description: 'Catálogo editable de grupos y partidas presupuestales aplicables a SMAA S.A. de C.V.',
        sections: [
            { title: 'Control del catálogo', fields: ownerFields },
            { title: 'Partidas autorizadas', paragraphs: ['Registre las partidas que SMAA S.A. de C.V. utiliza. Los conceptos de referencia permiten preparar el catálogo sin asignar importes ni aprobar partidas automáticamente.'], table: {
                key: 'partidas', label: 'Partidas del presupuesto', minRows: 1, columns: [f('codigo', 'Código de partida', 'text', { required: true }), f('grupo', 'Grupo o área', 'text', { required: true }), f('nombre', 'Nombre de partida', 'text', { required: true }), choices('estado', 'Estado', ['Activa', 'Inactiva']), f('observaciones', 'Observaciones')],
            } },
            { title: 'Conceptos del formato de referencia', paragraphs: [
                ...['Recursos humanos', 'Salud ocupacional', 'Operación', 'Seguridad e higiene', 'Administración', 'Impuestos'].map(group => `${group}: ${budgetCategoryLabels.filter(row => row[1] === group).map(row => `${row[0]} ${row[2]}`).join('; ')}.`),
                'Los códigos 1.6 y 1.18 del ejemplo corresponden a transporte de personal. Al preparar el catálogo de SMAA, consolide el concepto si se trata de la misma partida.',
            ] },
        ],
    },
    {
        key: 'checklist-proveedor-potencial', code: 'GAD-F-03', title: 'Checklist de requisitos de proveedores potenciales', kind: 'form', area: 'Administración y finanzas', priority: 3,
        sourceFiles: ['Ejemplo - Check list de Requisitos Proveedores Potenciales.xls'], sourceIsExample: true,
        description: 'Verificación documental y aprobación de proveedores potenciales de SMAA S.A. de C.V.',
        sections: [
            { title: 'Proveedor y fecha', fields: [f('proveedor', 'Nombre del proveedor', 'text', { required: true }), f('fecha', 'Fecha de revisión', 'date', { required: true })] },
            { title: 'Documentos y datos solicitados', paragraphs: ['Los documentos entregados por el proveedor deben estar membretados y firmados cuando corresponda. Indique No aplica cuando el requisito no corresponda al proveedor evaluado.'], table: {
                key: 'requisitos', label: 'Requisitos del proveedor', fixedRows: true,
                columns: [f('numero', 'Número', 'text', { readOnly: true }), f('requisito', 'Documento o dato', 'text', { readOnly: true }), choices('entregado', 'Entregado', yesNo, true), f('comentarios', 'Comentarios o referencia de evidencia')],
                initialRows: supplierRequirements.map((requisito, index) => ({ numero: String(index + 1), requisito })),
            } },
            { title: 'Otros requisitos', fields: [f('otros_requisitos', 'Detalle de otros requisitos', 'textarea')] },
            { title: 'Evaluación de SMAA S.A. de C.V.', fields: [
                choices('aprobado', 'Proveedor aprobado', ['Sí', 'No'], true), f('comentarios_aprobacion', 'Comentarios de aprobación', 'textarea'),
                f('aprobado_por', 'Aprobado por el coordinador de adquisiciones'), signature('firma_aprobacion', 'Firma de aprobación'), f('fecha_aprobacion', 'Fecha de aprobación', 'date'),
            ] },
        ],
    },
];
