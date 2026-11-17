import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createDigitalTestDatabase } from './digital-test-db';
import { buildControlledCatalogExtensionSql, parseControlledDocumentSnapshot, prepareExtensionTemplates } from './prepare-controlled-catalog-extension';
import { spreadsheetTemplates } from '../src/lib/documents/spreadsheetTemplates';
import { narrativeTemplates } from '../src/lib/documents/narrativeTemplates';
import { digitalTemplateContent } from '../src/lib/documents/catalog';
import { prepareIso2026 } from '../src/lib/documents/iso2026';
import { initialDigitalValues, type DigitalTemplate } from '../src/lib/documents/schema';
import { generateDigitalPdf } from '../src/lib/documents/pdf';

async function main() {
    // Only assigned identifiers and synthetic content: never import private
    // company source files into a committed test or application bundle.
    const newCodes = ['DOC-RHU-01','DOC-RHU-02','COM-01','VTA-01','PRD-01','VTA-F-01','VTA-F-02','VTA-F-03',
        'PRD-F-01','PRD-F-02','PRD-F-03','PRD-F-04','PRD-F-05','COM-F-01','COM-F-02','SGC-MC-01','ISO-F-15','ISO-F-16',
        'POL-ISO-01','PGR-ISO-02','GAD-F-04','ALM-F-01','MP-ISO-04'];
    const synthetic: DigitalTemplate[] = newCodes.map((code, index) => ({
        key: `new-test-${index + 1}`, code, title: `Plantilla sintética ${code}`, kind: 'form', area: 'QA', priority: index,
        sourceFiles: [], sourceIsExample: false, description: 'Prueba de extensión controlada sin datos privados.',
        sections: [{ title: 'Datos sintéticos', fields: [{ key: 'observacion', label: 'Observación' }] }],
    }));
    const additions = prepareExtensionTemplates(synthetic);
    assert.equal(additions.length, 24);
    assert(additions.some(template => template.code === 'PGR-ISO-03'));
    assert.deepEqual(prepareExtensionTemplates(additions), additions, 'Preparing a complete manifest again must be idempotent');
    for (const template of additions) assert.deepEqual(prepareIso2026(template), template);
    const malicious = structuredClone(synthetic);
    malicious[0].priority = '1); DROP TABLE employees; --' as unknown as number;
    assert.throws(() => prepareExtensionTemplates(malicious), /metadatos/);

    const test = await createDigitalTestDatabase();
    const { client } = test;
    try {
        const employee = (await client.query("INSERT INTO employees(full_name) VALUES('Persona QA preservada') RETURNING id")).rows[0].id;
        const typeId = (await client.query("SELECT id FROM document_types WHERE code='PRO'")).rows[0].id;
        await client.query('CREATE TABLE public.extension_unrelated(id uuid PRIMARY KEY, amount numeric, description text)');
        await client.query("INSERT INTO extension_unrelated VALUES($1,4321.45,'Otra operación intacta')", [randomUUID()]);
        const oldTemplates: DigitalTemplate[] = structuredClone([...spreadsheetTemplates, ...narrativeTemplates]);
        assert.equal(oldTemplates.length, 31);
        oldTemplates[0].title = "Documento propio d'Área";
        oldTemplates[0].sections.push({ title: 'Decisión local', paragraphs: ['Instrucción escrita por el usuario: conservar el programa 2025 y revisar ISO 9001:2015.'] });
        const ids: string[] = [];
        for (const template of oldTemplates) {
            const id = randomUUID(); ids.push(id);
            await client.query(`INSERT INTO documents(id,folio,type_id,title,objective,scope,definitions,responsibilities,content,
                document_references,records,keywords,version,revision,status,created_by,source_key,digital_kind,area,priority_order,
                source_files,source_is_example,needs_adaptation,template_schema)
                VALUES($1,$2,$3,$4,'Objetivo local','Alcance local','Definición local','Responsabilidad local',$5,
                    'Referencias locales','Registro propio','Palabra local','1.0',1,'draft','Autor original',$6,$7,$8,$9,$10,$11,$12,$13)`,
                [id, template.code, typeId, template.title, digitalTemplateContent(template), template.key, template.kind,
                    template.area, template.priority, JSON.stringify(template.sourceFiles), template.sourceIsExample, !!template.needsAdaptation, template]);
        }
        await client.query(`UPDATE documents SET status='approved',approval_name='Firmante original QA',approval_role='Dirección',
            approval_signature_url='storage://controlled-document-signatures/qa/old.png',approval_signed_at='2026-10-01T12:00:00Z',effective_date='2026-10-01' WHERE id=$1`, [ids[0]]);
        await client.query(`INSERT INTO document_signatures(document_id,version,signer_name,signer_role,signature_url,signed_at,purpose)
            VALUES($1,'1.0','Firmante original QA','Dirección','storage://controlled-document-signatures/qa/old.png','2026-10-01T12:00:00Z','approval')`, [ids[0]]);
        await client.query(`INSERT INTO document_versions(document_id,version,revision,title,content,changed_by)
            VALUES($1,'0.9',1,'Revisión anterior ya guardada','Texto anterior que se conserva','Autor anterior QA')`, [ids[0]]);
        await client.query(`INSERT INTO document_requests(type,target_document_id,title,reason,payload,status,requested_by)
            VALUES('change',$1,'Solicitud pendiente intacta','Prueba','{"title":"Solicitud","content":"Contenido solicitado"}','pending_doc_control',$2)`, [ids[0], employee]);
        const entryId = randomUUID();
        const originalEntryValues = initialDigitalValues(oldTemplates[0]);
        const oldPdf = generateDigitalPdf({ template: oldTemplates[0], values: originalEntryValues, folio: 'QA/2026/0001',
            templateVersion: '1.0', templateRevision: 1, revision: 1, status: 'finalized', authorName: 'Persona QA', savedAt: '2026-11-01T12:00:00Z' });
        await client.query(`INSERT INTO document_entries(id,document_id,folio,revision,template_version,template_revision,template_snapshot,values,status,
            created_by,created_by_name,updated_by,updated_by_name,finalized_at)
            VALUES($1,$2,'QA/2026/0001',1,'1.0',1,$3,$4,'finalized',$5,'Persona QA',$5,'Persona QA',now())`, [entryId, ids[0], oldTemplates[0], originalEntryValues, employee]);
        await client.query(`INSERT INTO document_entry_versions(entry_id,revision,template_version,template_revision,template_snapshot,values,status,
            pdf_path,sha256,pdf_size,created_by,created_by_name)
            VALUES($1,1,'1.0',1,$2,$3,'finalized','entries/qa/original.pdf',$4,$5,$6,'Persona QA')`,
            [entryId, oldTemplates[0], originalEntryValues, oldPdf.sha256, oldPdf.bytes.length, employee]);

        const rows = async (table: string) => (await client.query(`SELECT to_jsonb(t) row FROM public.${table} t ORDER BY id`)).rows.map(row => row.row);
        const documentsBefore = await rows('documents');
        const versionsBefore = await rows('document_versions');
        const preservedTables = ['employees','document_signatures','document_requests','document_entries','document_entry_versions','extension_unrelated'];
        const preserved = async () => {
            const result: Record<string, unknown[]> = {};
            for (const table of preservedTables) result[table] = await rows(table);
            return result;
        };
        const preservedBefore = await preserved();
        const snapshot = parseControlledDocumentSnapshot(documentsBefore);
        const sql = buildControlledCatalogExtensionSql(snapshot, additions, "SMAA d'Integración QA");
        const rejected = async (statement: string, pattern: RegExp) => {
            try { await assert.rejects(client.query(statement), pattern); }
            finally { await client.query('ROLLBACK'); }
        };
        assert.throws(() => buildControlledCatalogExtensionSql([{ ...snapshot[0], id: "'); DELETE FROM documents; --" }, ...snapshot.slice(1)], additions), /inválida/);
        assert.throws(() => buildControlledCatalogExtensionSql([snapshot[0],snapshot[0],...snapshot.slice(2)], additions), /duplicados/);

        await client.query("UPDATE documents SET updated_at=updated_at+interval '1 second' WHERE id=$1", [ids[5]]);
        const afterConcurrentTime = await rows('documents');
        await rejected(sql, /catálogo cambió/);
        assert.deepEqual(await rows('documents'), afterConcurrentTime, 'Stale timestamp must prevent every revision and insertion');
        await client.query('UPDATE documents SET updated_at=$2 WHERE id=$1', [ids[5], snapshot.find(row => row.id === ids[5])!.updated_at]);
        await client.query('UPDATE documents SET revision=revision+1 WHERE id=$1', [ids[6]]);
        await rejected(sql, /catálogo cambió/);
        await client.query('UPDATE documents SET revision=$2 WHERE id=$1', [ids[6], snapshot.find(row => row.id === ids[6])!.revision]);
        const extraId = randomUUID();
        await client.query("INSERT INTO documents(id,folio,type_id,title,content) VALUES($1,'QA-EXTRA',$2,'Alta posterior','Dato que no se debe sobrescribir')", [extraId,typeId]);
        await rejected(sql, /catálogo cambió/);
        await client.query('DELETE FROM documents WHERE id=$1', [extraId]);

        // This failure happens after all 31 version snapshots have been made,
        // proving that the complete extension is atomic, not a partial import.
        await client.query("UPDATE document_types SET code='QA_MISSING_FOR' WHERE code='FOR'");
        await rejected(sql, /null value|not-null/i);
        assert.deepEqual(await rows('documents'), documentsBefore, 'Late new-document insertion error rolls back all old revisions');
        assert.deepEqual(await rows('document_versions'), versionsBefore);
        assert.deepEqual(await preserved(), preservedBefore);
        await client.query("UPDATE document_types SET code='FOR' WHERE code='QA_MISSING_FOR'");
        await client.query(sql);
        const after = await rows('documents');
        assert.equal(after.length,55);
        for (const old of documentsBefore) {
            const updated = after.find(row => row.id === old.id)!;
            assert(updated, 'Every old stable ID must still exist');
            assert.equal(updated.folio,old.folio); assert.equal(updated.source_key,old.source_key);
            assert.equal(updated.revision,old.revision+1); assert.equal(updated.version,'1.1'); assert.equal(updated.status,'draft');
            assert.deepEqual(updated.template_schema,prepareIso2026({ ...old.template_schema,code:old.folio,title:old.title }));
            for (const name of ['objective','scope','definitions','responsibilities','document_references','records','keywords','created_by','created_at','type_id']) assert.deepEqual(updated[name],old[name]);
        }
        const allVersions = await rows('document_versions');
        assert.equal(allVersions.length,versionsBefore.length+31);
        for (const version of versionsBefore) assert.deepEqual(allVersions.find(row=>row.id===version.id),version);
        for (const old of documentsBefore) assert.deepEqual(allVersions.find(version=>version.document_snapshot?.id===old.id)?.document_snapshot,old);
        assert.deepEqual(await preserved(),preservedBefore,'Signatures, requests, captured schema, PDF path/bytes hash and unrelated operations must remain unchanged');
        assert.equal(createHash('sha256').update(oldPdf.bytes).digest('hex'),oldPdf.sha256);
        const inserted = after.filter(row=>!ids.includes(row.id));
        assert.equal(inserted.length,24);
        assert(inserted.every(row=>row.status==='draft'&&row.version==='1.0'&&row.revision===1&&row.approval_name===null&&row.approval_signed_at===null&&row.effective_date===null));
        for (const row of inserted) assert.deepEqual(row.template_schema,additions.find(template=>template.code===row.folio));
        const beforeRepeat = await rows('documents');
        await rejected(sql,/catálogo cambió/);
        assert.deepEqual(await rows('documents'),beforeRepeat);
        console.log('PASS: 31 existing IDs/codes and full histories preserved; captured PDF snapshots/values/SHA unchanged; 24 unapproved drafts; timestamp/revision/new-row guards; late-error rollback; ISO preparation idempotent; literal SQL values safe; no private source fixtures.');
    } finally { await test.cleanup(); }
}
main().catch(error=>{ console.error(error);process.exitCode=1; });
