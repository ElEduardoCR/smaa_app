import { spreadsheetTemplates } from './spreadsheetTemplates';
import { narrativeTemplates } from './narrativeTemplates';
import type { DigitalTemplate } from './schema';

export const documentTemplates: DigitalTemplate[] = [...spreadsheetTemplates, ...narrativeTemplates]
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));

export function getDigitalTemplate(key: string) {
    return documentTemplates.find(template => template.key === key);
}

export const DIGITAL_KIND_LABELS: Record<DigitalTemplate['kind'], string> = {
    form: 'Formato', document: 'Documento', register: 'Registro maestro',
    process_map: 'Mapa de proceso', presentation: 'Revisión por la Dirección',
};

export function digitalTemplateContent(template: DigitalTemplate) {
    return template.sections.map(section => [
        section.title, ...(section.paragraphs || []),
        ...(section.fields || []).map(field => field.label),
        ...(section.table ? [section.table.label, section.table.columns.map(field => field.label).join(' | ')] : []),
    ].join('\n')).join('\n\n');
}
