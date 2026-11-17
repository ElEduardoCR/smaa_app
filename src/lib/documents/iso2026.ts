import type { DigitalField, DigitalSection, DigitalTemplate } from './schema';

export const ISO_2026_BASELINE = 'ISO 9001:2026';
export const ISO_2026_NOTE = 'Preparado para revisión de la transición normativa y aprobación interna.';
export const ISO_2026_SOURCES = [
    'https://www.iso.org/quality-management/iso-9001-2026',
    'https://www.iso.org/standard/9001',
    'https://www.iso.org/files/live/sites/isoorg/files/store/en/PUB100373.pdf',
];

const field = (key: string, label: string, type: DigitalField['type'] = 'textarea'): DigitalField => ({ key, label, type });
const knownTopics = [
    ['4', 'Contexto, partes interesadas y pertinencia del cambio climático'],
    ['5', 'Liderazgo y responsabilidades del sistema de gestión'],
    ['5.1', 'Liderazgo, cultura de calidad y comportamiento ético'],
    ['5.2', 'Política de calidad y dirección estratégica'],
    ['6', 'Planificación de objetivos y cambios'],
    ['6.1', 'Tratamiento diferenciado de riesgos y oportunidades'],
    ['7', 'Apoyo, competencia e información documentada'],
    ['7.3', 'Toma de conciencia y contribución de las personas'],
    ['8', 'Control operacional e interfaces entre procesos'],
    ['9', 'Evaluación del desempeño y revisión de resultados'],
    ['10', 'Mejora y verificación de eficacia'],
];

const relations: Record<string, string[]> = {
    'procedimiento-recursos-humanos': ['DOC-RHU-01', 'DOC-RHU-02', 'ISO-F-16'],
    'mapa-comunicacion': ['SGC-MC-01', 'ISO-F-16'],
    'mapa-facturacion-cobranza': ['ISO-F-15', 'GAD-01', 'VTA-01'],
    'criterios-evaluacion-proveedores': ['COM-01', 'GAD-F-03', 'GAD-F-04', 'COM-F-02'],
    'checklist-proveedor-potencial': ['COM-01', 'DOC-GAD-01', 'GAD-F-04'],
    'revision-direccion': ['PGR-ISO-02', 'POL-ISO-01', 'MP-ISO-04'],
    'requisicion-accion-correctiva': ['PRD-F-05', 'PRD-01'],
    'listado-maestro-documentos': ['ISO-F-02', 'ISO-F-05'],
};

/** A controlled draft for transition review, never a claim of certification.
 * The licensed clause-by-clause review remains an explicit task in PGR-ISO-03.
 * Historic PDFs and entry schemas are deliberately not rewritten. */
export function prepareIso2026(source: DigitalTemplate): DigitalTemplate {
    const updateReference = (value: unknown, key = ''): unknown => {
        if (typeof value === 'string') {
            if (['key', 'code', 'fileName', 'storagePath', 'sha256', 'sourceFiles'].includes(key) || /(?:original|fuente|hist[oó]ric[oa]|edici[oó]n anterior|referencia de origen|edici[oó]n de origen|62085\.html)/i.test(value)) return value;
            return value.replace(/ISO\s*9001\s*:\s*(?:2015|2025)/g, ISO_2026_BASELINE);
        }
        if (Array.isArray(value)) return value.map(item => updateReference(item, key));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, updateReference(item, name)]));
        return value;
    };
    const template = updateReference(source) as DigitalTemplate;
    template.normativeBaseline = ISO_2026_BASELINE;
    template.transitionNote = template.transitionNote?.includes(ISO_2026_NOTE) ? template.transitionNote : [ISO_2026_NOTE, template.transitionNote].filter(Boolean).join(' ');
    template.needsAdaptation = true;
    template.relatedCodes = [...new Set([...(template.relatedCodes || []), ...(relations[template.key] || []), 'PGR-ISO-03'])].filter(code => code !== template.code);
    const append = (section: DigitalSection) => {
        if (!template.sections.some(existing => existing.title === section.title)) template.sections.push(section);
    };
    if (template.key === 'resultados-auditoria-requisitos') {
        const section = template.sections.find(section => section.table?.key === 'hallazgos');
        if (section?.table) {
            section.table.initialRows = knownTopics.map(([clausula, requisito]) => ({ clausula, requisito }));
            section.paragraphs = [
                'Matriz preliminar por temas y referencias públicas verificadas. La revisión con el texto autorizado de la norma completa el detalle de subcláusulas antes de aprobar su uso como lista exhaustiva.',
                'Cada hallazgo se registra una sola vez. Los conteos de revisiones anteriores se conservan con la matriz utilizada al capturarlos.',
            ];
        }
    }
    if (template.key === 'lista-verificacion-auditoria') append({
        title: 'Revisión de la transición a ISO 9001:2026',
        table: { key: 'verificacion_iso2026', label: 'Temas de revisión de la transición', fixedRows: true,
            columns: [
                { key: 'referencia', label: 'Referencia', readOnly: true },
                { key: 'tema', label: 'Tema', readOnly: true },
                { key: 'resultado', label: 'Resultado', type: 'select', options: ['Cumple', 'No cumple', 'No aplica', 'Pendiente de verificar'] },
                field('evidencia', 'Evidencia o hallazgo'),
            ], initialRows: knownTopics.map(([referencia, tema]) => ({ referencia, tema })) },
    });
    if (template.key === 'revision-direccion') append({
        title: 'Decisiones para la transición normativa', fields: [
            field('iso2026_cultura_etica', 'Evidencias de cultura de calidad y comportamiento ético'),
            field('iso2026_politica_estrategia', 'Coherencia entre política, contexto y estrategia'),
            field('iso2026_riesgos', 'Riesgos revisados y decisiones de tratamiento'),
            field('iso2026_oportunidades', 'Oportunidades revisadas y decisiones para aprovecharlas'),
            field('iso2026_personas', 'Toma de conciencia y participación de las personas'),
            field('iso2026_continuidad', 'Continuidad, información y efectos del contexto climático y tecnológico'),
        ],
    });
    if (template.key === 'matriz-control-cambios') append({
        title: 'Riesgos y oportunidades del cambio', table: {
            key: 'iso2026_riesgos_oportunidades', label: 'Análisis diferenciado', minRows: 0,
            columns: [{ key: 'tipo', label: 'Tipo', type: 'select', options: ['Riesgo', 'Oportunidad'] },
                field('situacion', 'Situación'), field('accion', 'Acción prevista'), field('responsable', 'Responsable', 'text'),
                field('fecha', 'Fecha de revisión', 'date'), field('evidencia', 'Resultado y evidencia')],
        },
    });
    if (template.key === 'deteccion-necesidades-capacitacion') append({
        title: 'Conciencia y cultura de calidad', fields: [
            field('iso2026_necesidades', 'Necesidades de toma de conciencia sobre calidad y ética'),
            field('iso2026_evaluacion', 'Cómo se verificará la comprensión y aplicación en el puesto'),
        ],
    });
    if (template.key === 'procedimiento-recursos-humanos') append({
        title: 'Preparación de las personas para la transición', paragraphs: [
            'Recursos Humanos integra en la inducción y formación los compromisos de calidad y conducta ética aprobados por SMAA. Registra participantes y verifica su comprensión en las actividades del puesto.',
            'Las necesidades detectadas se vinculan con RHU-F-01; la asignación de funciones se revisa con DOC-RHU-01, DOC-RHU-02 e ISO-F-16.',
        ],
    });
    return template;
}

export const iso2026TransitionTemplate: DigitalTemplate = {
    key: 'plan-transicion-iso2026', code: 'PGR-ISO-03', title: 'Plan de transición a ISO 9001:2026',
    kind: 'form', area: 'ISO', priority: 3, sourceFiles: [], sourceIsExample: false,
    needsAdaptation: true, normativeBaseline: ISO_2026_BASELINE, transitionNote: ISO_2026_NOTE,
    description: 'Controla la revisión de brechas, actualización documental, formación, evidencias y aprobación de la transición del SGC de SMAA.',
    relatedCodes: ['ISO-P-01', 'POL-ISO-01', 'ISO-F-01', 'ISO-F-05', 'ISO-F-10', 'ISO-F-11'],
    sections: [
        { title: 'Control de la transición', fields: [
            { key: 'responsable', label: 'Responsable del plan', required: true },
            { key: 'fecha', label: 'Fecha de apertura', type: 'date', required: true },
            field('alcance', 'Procesos y documentos comprendidos'), field('objetivo', 'Resultado esperado y criterio de cierre'),
        ] },
        { title: 'Áreas de revisión', paragraphs: [
            'Revisar liderazgo, cultura de calidad, ética y coherencia estratégica. Distinguir riesgos de oportunidades y verificar la conciencia de las personas. Considerar el contexto climático y tecnológico cuando sea pertinente.',
            'El equipo completa la comparación de requisitos con una copia autorizada de la norma, asigna acciones y verifica evidencias. Dirección revisa los resultados y aprueba el cierre documental.',
            'Este plan prepara la transición. La aprobación de documentos y la evaluación de conformidad se registran como actividades separadas.',
        ], table: { key: 'brechas', label: 'Brechas y acciones', minRows: 1, columns: [
            { key: 'codigo', label: 'Código del documento o proceso', required: true },
            { key: 'referencia', label: 'Referencia verificada', required: true },
            field('brecha', 'Brecha identificada'), field('accion', 'Acción'), field('responsable', 'Responsable', 'text'),
            field('compromiso', 'Fecha compromiso', 'date'),
            { key: 'estado', label: 'Estado', type: 'select', options: ['Pendiente', 'En revisión', 'Implementada', 'Verificada'] },
            field('evidencia', 'Evidencia y resultado de verificación'),
        ] } },
        { title: 'Hitos del plan', table: { key: 'hitos', label: 'Revisión y aprobación', fixedRows: true, columns: [
            { key: 'actividad', label: 'Actividad', readOnly: true }, field('responsable', 'Responsable', 'text'),
            field('fecha', 'Fecha', 'date'), field('evidencia', 'Resultado o evidencia'),
        ], initialRows: [
            { actividad: 'Disponer de la norma completa y verificar los requisitos aplicables' },
            { actividad: 'Comparar requisitos con el SGC y aprobar el análisis de brechas' },
            { actividad: 'Actualizar y revisar documentos conservando sus versiones anteriores' },
            { actividad: 'Formar a las personas y verificar su comprensión' },
            { actividad: 'Auditar la implementación y cerrar las acciones pendientes' },
            { actividad: 'Revisar resultados y aprobar el cierre por Dirección' },
        ] } },
        { title: 'Fuentes para la preparación', paragraphs: ISO_2026_SOURCES },
        { title: 'Aprobación del cierre', fields: [field('aprobador', 'Nombre de quien aprueba', 'text'), field('firma_aprobacion', 'Firma de aprobación', 'signature'), field('fecha_aprobacion', 'Fecha de aprobación', 'date')] },
    ],
};
