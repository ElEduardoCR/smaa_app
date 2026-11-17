/** Offline preparation only. Private source JSON is read only when explicitly
 * supplied at the command line; it is never imported into the app bundle. */
import { createHash } from 'node:crypto';
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digitalTemplateContent } from '../src/lib/documents/catalog';
import { initialDigitalValues, type DigitalTemplate } from '../src/lib/documents/schema';
import { prepareIso2026, iso2026TransitionTemplate } from '../src/lib/documents/iso2026';
import { readDigitalTemplate, validateDigitalValues } from '../src/lib/documents/validation';

export type ControlledDocumentSnapshot = {
    id: string; folio: string; title: string; source_key: string; revision: number;
    updated_at: string | Date; template_schema: DigitalTemplate;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const typeCode = (template: DigitalTemplate) => template.kind === 'form' ? 'FOR' : template.kind === 'register' ? 'REG' : template.kind === 'presentation' ? 'PLA' : template.code.startsWith('POL-') ? 'POL' : template.code.startsWith('PGR-') ? 'PLA' : template.code.startsWith('DOC-RHU-') ? 'MAN' : 'PRO';

function validateTemplate(template: DigitalTemplate) {
    readDigitalTemplate(template);
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(template.code) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(template.key) ||
        !['form','document','process_map','presentation','register'].includes(template.kind) ||
        typeof template.area !== 'string' || template.area.length > 200 ||
        typeof template.description !== 'string' || template.description.length > 10000 ||
        !Number.isSafeInteger(template.priority) || template.priority < 0 || template.priority > 10000 ||
        typeof template.sourceIsExample !== 'boolean' || !Array.isArray(template.sourceFiles) ||
        template.sourceFiles.some(file => typeof file !== 'string' || !file || file.length > 255 || basename(file) !== file)) {
        throw new Error('La identificación o los metadatos de una plantilla no son válidos.');
    }
    validateDigitalValues(template, initialDigitalValues(template), false);
}

export function parseControlledDocumentSnapshot(input: unknown): ControlledDocumentSnapshot[] {
    const value = input as { rows?: unknown; documents?: unknown };
    const rows = Array.isArray(input) ? input : value?.rows ?? value?.documents;
    if (!Array.isArray(rows) || rows.length !== 31) throw new Error('La instantánea debe contener los 31 documentos actuales completos.');
    const ids = new Set<string>(), codes = new Set<string>(), keys = new Set<string>();
    return rows.map((raw: ControlledDocumentSnapshot) => {
        if (!raw || !uuid.test(raw.id) || ids.has(raw.id) || typeof raw.folio !== 'string' || !raw.folio || codes.has(raw.folio) ||
            typeof raw.title !== 'string' || !raw.title.trim() || !Number.isInteger(raw.revision) || raw.revision < 1 ||
            !raw.updated_at || !Number.isFinite(new Date(raw.updated_at).getTime()) || typeof raw.source_key !== 'string' || !raw.source_key || keys.has(raw.source_key)) {
            throw new Error('Instantánea documental inválida o con identificadores duplicados.');
        }
        readDigitalTemplate(raw.template_schema);
        if (raw.source_key !== raw.template_schema.key) throw new Error('La instantánea contiene una plantilla que no corresponde al documento.');
        ids.add(raw.id); codes.add(raw.folio); keys.add(raw.source_key);
        // Keep PostgreSQL microseconds from the JSON snapshot. Date#toISOString
        // would truncate them and make an unchanged production row look stale.
        return { ...raw, updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : raw.updated_at.toISOString() };
    });
}

export function prepareExtensionTemplates(sources: DigitalTemplate[], sourceDirectory?: string): DigitalTemplate[] {
    const templates = [...sources];
    if (!templates.some(template => template.code === iso2026TransitionTemplate.code)) templates.push(iso2026TransitionTemplate);
    if (templates.length !== 24) throw new Error(`Se esperaban 23 documentos y formatos de las fuentes más el plan de transición; hay ${templates.length}.`);
    const files = sourceDirectory ? readdirSync(sourceDirectory) : [];
    const prepared = templates.map(source => {
        let template = prepareIso2026(source);
        const originals = template.sourceFiles.filter(file => /\.pdf$/i.test(file));
        if (originals.length && sourceDirectory) {
            template = { ...template, sourceEvidence: originals.map(name => {
                const found = files.find(file => file.normalize('NFC') === name.normalize('NFC'));
                if (!found || basename(found) !== found) throw new Error(`No se encontró el PDF original: ${name}`);
                const sha256 = createHash('sha256').update(readFileSync(join(sourceDirectory, found))).digest('hex');
                return { label: /firmada/i.test(found) ? 'Original firmado aportado' : 'Documento original aportado',
                    fileName: found, sha256, storagePath: `sources/${sha256}.pdf` };
            }) };
        } else if (originals.length && !template.sourceEvidence?.length) throw new Error('Indica --source-dir para verificar y conservar los PDF de origen.');
        validateTemplate(template);
        return template;
    });
    const keys = new Set<string>(), codes = new Set<string>();
    for (const template of prepared) {
        if (keys.has(template.key) || codes.has(template.code) || /\b(?:XX|XXX)\b/.test(template.code)) throw new Error('Las nuevas plantillas tienen códigos o claves duplicados o pendientes.');
        if (template.normativeBaseline !== 'ISO 9001:2026') throw new Error('La base de revisión debe identificar ISO 9001:2026.');
        for (const evidence of template.sourceEvidence || []) if (!/^[a-f0-9]{64}$/.test(evidence.sha256) || evidence.storagePath !== `sources/${evidence.sha256}.pdf` || basename(evidence.fileName) !== evidence.fileName) throw new Error('Referencia de evidencia de origen inválida.');
        keys.add(template.key); codes.add(template.code);
    }
    return prepared;
}

export function buildControlledCatalogExtensionSql(snapshotInput: unknown, newTemplates: DigitalTemplate[], actor = 'Integración documental SMAA'): string {
    const snapshot = parseControlledDocumentSnapshot(snapshotInput);
    if (newTemplates.length !== 24 || !actor.trim() || actor.length > 200) throw new Error('Catálogo incremental o responsable de integración inválido.');
    const existing = snapshot.map(document => prepareIso2026({ ...document.template_schema, code: document.folio, title: document.title }));
    const combined = [...existing, ...newTemplates];
    const codes = new Set(combined.map(template => template.code)), keys = new Set(combined.map(template => template.key));
    if (codes.size !== 55 || keys.size !== 55) throw new Error('Un documento nuevo colisiona con un código o clave ya existente.');
    for (const template of combined) {
        validateTemplate(template);
        for (const code of template.relatedCodes || []) if (!codes.has(code)) throw new Error(`Referencia sin documento: ${template.code} → ${code}`);
        if (JSON.stringify(prepareIso2026(template)) !== JSON.stringify(template)) throw new Error(`Preparación normativa no idempotente en ${template.code}.`);
    }
    const guard = snapshot.map(({ id, revision, updated_at, template_schema }) => ({ id, revision, updated_at, template_schema }));
    const updateStatements = existing.map((template, index) => `SELECT public.update_digital_document_content(${quote(snapshot[index].id)}::uuid, ${snapshot[index].revision}, ${json(template)}, ${quote(digitalTemplateContent(template))}, ${quote(actor)}, 'Preparación controlada de la transición a ISO 9001:2026 y vinculación con los documentos aportados');`).join('\n');
    const insertRows = newTemplates.map(template => `(${quote(template.code)}, (SELECT id FROM public.document_types WHERE code=${quote(typeCode(template))}), ${quote(template.title)}, ${quote(template.description)}, ${quote(digitalTemplateContent(template))}, '1.0', 1, 'draft', ${quote(actor)}, ${quote(template.key)}, ${quote(template.kind)}, ${quote(template.area)}, ${template.priority}, ${json(template.sourceFiles)}, ${template.sourceIsExample}, ${!!template.needsAdaptation}, ${json(template)})`).join(',\n');
    return `BEGIN;
LOCK TABLE public.documents IN EXCLUSIVE MODE;
DO $extension_guard$ DECLARE v_matches integer; BEGIN
    SELECT count(*) INTO v_matches FROM jsonb_to_recordset(${json(guard)}) AS e(id uuid,revision integer,updated_at timestamptz,template_schema jsonb)
    JOIN public.documents d ON d.id=e.id AND d.revision=e.revision AND d.updated_at IS NOT DISTINCT FROM e.updated_at AND d.template_schema IS NOT DISTINCT FROM e.template_schema;
    IF v_matches <> 31 OR (SELECT count(*) FROM public.documents) <> 31 THEN
        RAISE EXCEPTION 'El catálogo cambió después de la instantánea; no se actualizó ningún documento. Prepare de nuevo la integración.';
    END IF;
END $extension_guard$;
${updateStatements}
INSERT INTO public.documents(folio,type_id,title,objective,content,version,revision,status,created_by,source_key,digital_kind,area,priority_order,source_files,source_is_example,needs_adaptation,template_schema) VALUES
${insertRows};
DO $extension_assert$ BEGIN
    IF (SELECT count(*) FROM public.documents) <> 55 THEN RAISE EXCEPTION 'El catálogo extendido no quedó completo'; END IF;
END $extension_assert$;
COMMIT;
`;
}

function readJson(path: string) { return JSON.parse(readFileSync(resolve(path), 'utf8')); }

function main() {
    const args = process.argv.slice(2);
    const get = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
    const templatePaths = args.flatMap((arg, index) => arg === '--templates' ? [args[index + 1]] : []);
    if (!get('--snapshot') || !templatePaths.length || templatePaths.some(path => !path)) throw new Error('Uso: tsx scripts/prepare-controlled-catalog-extension.ts --snapshot <privado.json> --templates <privado.json> [--templates <otro.json>] [--source-dir <carpeta>] [--output <privado.sql>] [--manifest <privado.json>]');
    const snapshot = parseControlledDocumentSnapshot(readJson(get('--snapshot')!));
    const templates = prepareExtensionTemplates(templatePaths.flatMap(path => {
        const value = readJson(path); if (!Array.isArray(value)) throw new Error('Cada archivo de plantillas debe contener un arreglo JSON.'); return value;
    }), get('--source-dir'));
    const sql = buildControlledCatalogExtensionSql(snapshot, templates, get('--actor'));
    const manifest = get('--manifest'), output = get('--output');
    if (manifest) { writeFileSync(resolve(manifest), JSON.stringify(templates, null, 2), { mode: 0o600 }); chmodSync(resolve(manifest), 0o600); }
    if (output) { writeFileSync(resolve(output), sql, { mode: 0o600 }); chmodSync(resolve(output), 0o600); }
    console.log(JSON.stringify({ existingDocuments: snapshot.length, revisedWithoutDeleting: snapshot.length, newDocuments: templates.length,
        resultingDocuments: snapshot.length + templates.length, originalSources: new Set(templates.flatMap(template => template.sourceFiles)).size,
        originalPdfs: new Set(templates.flatMap(template => template.sourceEvidence?.map(evidence => evidence.sha256) || [])).size,
        codes: templates.map(template => template.code), sqlPrepared: !!output, manifestPrepared: !!manifest }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (error) { console.error(error instanceof Error ? error.message : 'No se pudo preparar la integración.'); process.exitCode = 1; }
}
