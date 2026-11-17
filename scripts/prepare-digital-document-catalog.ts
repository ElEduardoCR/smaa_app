/** Prepare a reviewable, transactional replacement. This script never connects
 * to a database. Run with an explicit snapshot of the IDs being replaced. */
import { readFileSync, writeFileSync } from 'node:fs';
import { documentTemplates, digitalTemplateContent } from '../src/lib/documents/catalog';
import type { DigitalTemplate } from '../src/lib/documents/schema';
import { readDigitalTemplate, validateDigitalValues } from '../src/lib/documents/validation';
import { initialDigitalValues } from '../src/lib/documents/schema';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const typeCode = (template: DigitalTemplate) => template.kind === 'form' ? 'FOR' : template.kind === 'register' ? 'REG' : template.kind === 'presentation' ? 'PLA' : template.code === 'MANADM' ? 'MAN' : template.code.startsWith('IT-') ? 'INS' : template.code.startsWith('DOC-') ? 'POL' : 'PRO';

export function validateDigitalCatalogue() {
    if (documentTemplates.length !== 31) throw new Error(`Se esperaban 31 fuentes; hay ${documentTemplates.length}.`);
    const keys = new Set<string>(), codes = new Set<string>(), sources = new Set<string>();
    for (const template of documentTemplates) {
        readDigitalTemplate(template);
        if (keys.has(template.key) || codes.has(template.code) || /XX/.test(template.code)) throw new Error(`Código duplicado o pendiente: ${template.code}`);
        keys.add(template.key); codes.add(template.code);
        for (const source of template.sourceFiles) { if (sources.has(source.normalize('NFC'))) throw new Error(`Fuente repetida: ${source}`); sources.add(source.normalize('NFC')); }
        const visible = JSON.stringify({ ...template, sourceFiles: [] });
        if (/canacintra|canacitra|tecnol[oó]gico de|instituto tecnol[oó]gico|ITESM|Constructora Cuman|CUMAN/i.test(visible)) throw new Error(`Referencia ajena pendiente en ${template.code}.`);
        if (/\b(?:ISO-F|RHU-F|DOC-GAD|MP-ISO|MP-XXX|PGR-ISO)-XX\b/i.test(visible)) throw new Error(`Referencia con XX pendiente en ${template.code}.`);
        validateDigitalValues(template, initialDigitalValues(template), false);
    }
    if (sources.size !== 31) throw new Error(`La cobertura debe ser 31/31; hay ${sources.size}.`);
}

export function buildDigitalCatalogueSql(expectedIds: string[]) {
    validateDigitalCatalogue();
    if (expectedIds.some(id => !/^[a-f0-9-]{36}$/i.test(id))) throw new Error('La instantánea contiene un identificador no válido.');
    const ids = expectedIds.map(quote).join(',');
    const expected = expectedIds.length ? `ARRAY[${ids}]::uuid[]` : 'ARRAY[]::uuid[]';
    const records = documentTemplates.map(template => {
        const sanitizedSources = template.sourceFiles.map(source => source.replace(/CANACINTRA/gi, 'SMAA'));
        const storedTemplate = { ...template, sourceFiles: sanitizedSources };
        return `(${quote(template.code)}, (SELECT id FROM public.document_types WHERE code=${quote(typeCode(template))}), ${quote(template.title)}, ${quote(template.description)}, ${quote(digitalTemplateContent(template))}, '1.0', 1, 'draft', 'Digitalización SMAA', ${quote(template.key)}, ${quote(template.kind)}, ${quote(template.area)}, ${template.priority}, ${quote(JSON.stringify(sanitizedSources))}::jsonb, ${template.sourceIsExample}, ${!!template.needsAdaptation}, ${quote(JSON.stringify(storedTemplate))}::jsonb)`;
    }).join(',\n');
    return `BEGIN;
LOCK TABLE public.documents IN EXCLUSIVE MODE;
DO $catalog_check$ BEGIN
    IF (SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[]) FROM public.documents) IS DISTINCT FROM (SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(${expected}) x) THEN
        RAISE EXCEPTION 'El catálogo cambió después de preparar el reemplazo. No se eliminó ningún documento.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.document_entries) THEN RAISE EXCEPTION 'Existen capturas digitales. El reemplazo inicial no puede volver a ejecutarse.'; END IF;
END $catalog_check$;
DELETE FROM public.document_requests;
DELETE FROM public.documents;
DELETE FROM public.change_log WHERE entity_type IN ('document', 'document_version', 'document_request');
INSERT INTO public.documents(folio,type_id,title,objective,content,version,revision,status,created_by,source_key,digital_kind,area,priority_order,source_files,source_is_example,needs_adaptation,template_schema) VALUES
${records};
DO $catalog_assert$ BEGIN
    IF (SELECT count(*) FROM public.documents WHERE source_key IS NOT NULL) <> 31 THEN RAISE EXCEPTION 'El catálogo no quedó completo'; END IF;
END $catalog_assert$;
COMMIT;
`;
}

if (process.argv[1]?.endsWith('prepare-digital-document-catalog.ts')) {
    const snapshotPath = process.argv[2], outputPath = process.argv[3];
    validateDigitalCatalogue();
    if (snapshotPath && outputPath) {
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        const rows = Array.isArray(snapshot) ? snapshot : snapshot.rows;
        const ids = rows.map((row: { id: string }) => row.id);
        writeFileSync(outputPath, buildDigitalCatalogueSql(ids), { mode: 0o600 });
        console.log(`Reemplazo preparado: ${ids.length} documentos anteriores → 31 documentos y formatos SMAA. Archivo SQL: ${outputPath}`);
    } else console.log(JSON.stringify(documentTemplates.map(({ code, title, kind, sourceFiles }) => ({ code, title, kind, fuentes: sourceFiles.length })), null, 2));
}
