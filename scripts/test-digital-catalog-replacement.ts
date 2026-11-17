import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDigitalTestDatabase } from './digital-test-db';
import { buildDigitalCatalogueSql, validateDigitalCatalogue } from './prepare-digital-document-catalog';
import { documentTemplates } from '../src/lib/documents/catalog';

async function main() {
    const { client, cleanup } = await createDigitalTestDatabase();
    try {
        // Reproduce document/version audit triggers so deletion is checked in
        // the same order as production, including logs created by the deletes.
        const original = readFileSync('supabase/migrations/20260721140000_documents_and_change_log.sql', 'utf8');
        await client.query(original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.tg_log_change()'), original.indexOf('-- 9) Apply trigger')));
        await client.query(`CREATE TRIGGER trg_log_documents AFTER INSERT OR UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION tg_log_change('document');
            CREATE TRIGGER trg_log_document_versions AFTER INSERT OR UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION tg_log_change('document_version');
            CREATE TABLE public.ar_invoices(id uuid PRIMARY KEY, client_name text, amount numeric(12,2), status text);
            CREATE TABLE public.requisitions(id uuid PRIMARY KEY, description text, status text);`);
        const employeeId = (await client.query("INSERT INTO employees(full_name,role) VALUES('Empleado que se conserva','master') RETURNING id")).rows[0].id;
        const invoiceId = randomUUID(), requisitionId = randomUUID();
        await client.query("INSERT INTO ar_invoices VALUES($1,'Cliente externo sin cambios',12345.67,'partial')", [invoiceId]);
        await client.query("INSERT INTO requisitions VALUES($1,'Material pendiente de compra','pending')", [requisitionId]);
        const typeId = (await client.query("SELECT id FROM document_types WHERE code='PRO'")).rows[0].id;
        const oldIds = [randomUUID(), randomUUID()];
        for (const [index, id] of oldIds.entries()) {
            await client.query(`INSERT INTO documents(id,folio,type_id,title,content,status,approval_name,approval_signature_url)
                VALUES($1,$2,$3,$4,'Contenido anterior completo','approved','Firmante anterior QA','https://example.invalid/old-signature.png')`,
                [id, `PRO-00${index + 1}`, typeId, `Documento anterior ${index + 1}`]);
            await client.query(`INSERT INTO document_versions(document_id,version,revision,title,content,changed_by)
                VALUES($1,'0.9',1,'Versión anterior QA','Texto histórico que se elimina','Autor anterior QA')`, [id]);
            await client.query(`INSERT INTO document_signatures(document_id,version,signer_name,signature_url)
                VALUES($1,'1.0','Firmante anterior QA','https://example.invalid/old-signature.png')`, [id]);
        }
        const requestIds = [randomUUID(), randomUUID(), randomUUID()];
        await client.query(`INSERT INTO document_requests(id,type,target_document_id,resulting_document_id,title,reason,payload,status,requested_by)
            VALUES($1,'change',$4,NULL,'Cambio anterior','QA','{"title":"Cambio anterior","content":"Anterior"}','pending_doc_control',$6),
                  ($2,'new',NULL,$5,'Alta anterior publicada','QA','{"title":"Alta anterior","content":"Anterior"}','published',$6),
                  ($3,'new',NULL,NULL,'Propuesta anterior sin vínculo','QA','{"title":"Propuesta anterior","content":"Anterior"}','pending_doc_control',$6)`,
            [...requestIds, ...oldIds, employeeId]);
        for (const id of requestIds) await client.query(`INSERT INTO change_log(entity_type,entity_id,action,description,changed_by)
            VALUES('document_request',$1,'create','Historial anterior de solicitud','QA')`, [id]);
        const financeLogId = (await client.query(`INSERT INTO change_log(entity_type,entity_id,action,description,changed_by)
            VALUES('ar_invoice',$1,'update','Historial financiero que se conserva','Finanzas QA') RETURNING id`, [invoiceId])).rows[0].id;

        const relatedTables = ['documents', 'document_versions', 'document_signatures', 'document_requests', 'change_log'];
        const snapshot = async (tables = relatedTables) => {
            const result: Record<string, unknown[]> = {};
            for (const table of tables) result[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows.map(r => r.row);
            return result;
        };
        const unchangedTables = ['employees', 'ar_invoices', 'requisitions', 'document_types'];
        const unrelatedBefore = await snapshot(unchangedTables);
        const originals = await snapshot();

        const rejected = async (sql: string, pattern: RegExp, expected = originals) => {
            try { await assert.rejects(client.query(sql), pattern); }
            finally { await client.query('ROLLBACK'); }
            assert.deepEqual(await snapshot(), expected, 'Rejected replacement must preserve every original row, signature and history');
            assert.deepEqual(await snapshot(unchangedTables), unrelatedBefore, 'Rejected replacement must not touch other modules');
        };
        await rejected(buildDigitalCatalogueSql([randomUUID()]), /catálogo cambió/);
        await rejected(buildDigitalCatalogueSql([]), /catálogo cambió/);
        await rejected(buildDigitalCatalogueSql([oldIds[0], oldIds[0]]), /catálogo cambió/);
        assert.throws(() => buildDigitalCatalogueSql(["'); DROP TABLE employees; --"]), /identificador no válido/);

        // A document created after the explicit snapshot must also stop the
        // replacement rather than being swept away by an unconditional delete.
        const lateId = randomUUID();
        await client.query(`INSERT INTO documents(id,folio,type_id,title,content) VALUES($1,'PRO-099',$2,'Documento nuevo posterior','No se debe borrar')`, [lateId, typeId]);
        const withLateDocument = await snapshot();
        await rejected(buildDigitalCatalogueSql(oldIds), /catálogo cambió/, withLateDocument);
        await client.query('DELETE FROM documents WHERE id=$1', [lateId]);

        // The guard must be atomic even when a later INSERT fails. Temporarily
        // remove one required type using a transaction-local name change.
        const beforeLateFailure = await snapshot();
        await client.query("UPDATE document_types SET code='QA_FOR_MISSING' WHERE code='FOR'");
        const typesWithoutFor = await snapshot(unchangedTables);
        try { await assert.rejects(client.query(buildDigitalCatalogueSql(oldIds)), /null value|not-null/i); }
        finally { await client.query('ROLLBACK'); }
        assert.deepEqual(await snapshot(), beforeLateFailure, 'Late insertion error must roll back document, request, signature and history deletion');
        assert.deepEqual(await snapshot(unchangedTables), typesWithoutFor);
        await client.query("UPDATE document_types SET code='FOR' WHERE code='QA_FOR_MISSING'");

        // Exercise SQL quoting with a legitimate apostrophe and reject foreign
        // organization names in visible content before writing any SQL.
        const first = documentTemplates[0];
        const savedTitle = first.title, savedDescription = first.description;
        let replacementSql: string;
        let expectedCatalogue: typeof documentTemplates;
        try {
            first.description = 'Documento de Constructora Cuman';
            assert.throws(validateDigitalCatalogue, /Referencia ajena/);
            first.description = savedDescription;
            first.title = `${savedTitle} d'Área`;
            replacementSql = buildDigitalCatalogueSql(oldIds);
            expectedCatalogue = JSON.parse(JSON.stringify(documentTemplates.map(template => ({ ...template,
                sourceFiles: template.sourceFiles.map(source => source.replace(/CANACINTRA/gi, 'SMAA')) }))));
        } finally { first.title = savedTitle; first.description = savedDescription; }
        await client.query(replacementSql!);
        const documents = (await client.query('SELECT * FROM documents ORDER BY folio')).rows;
        assert.equal(documents.length, 31);
        assert.equal(new Set(documents.map(doc => doc.folio)).size, 31);
        assert.equal(new Set(documents.map(doc => doc.source_key)).size, 31);
        assert(documents.every(doc => doc.status === 'draft' && doc.version === '1.0' && doc.revision === 1));
        assert(documents.every(doc => doc.approval_name === null && doc.approval_role === null && doc.approval_signature_url === null &&
            doc.approval_signed_at === null && doc.effective_date === null && doc.next_review_date === null), 'Imported examples cannot invent approvals or validity');
        assert(!documents.some(doc => oldIds.includes(doc.id)));
        for (const table of ['document_versions', 'document_signatures', 'document_requests']) {
            assert.equal((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0, `${table}: every old version, signature and request is removed`);
        }
        assert.equal((await client.query("SELECT count(*)::int n FROM change_log WHERE entity_type IN ('document_version','document_request')")).rows[0].n, 0);
        const newIds = documents.map(doc => doc.id);
        const docLogs = (await client.query("SELECT entity_id,action FROM change_log WHERE entity_type='document'")).rows;
        assert.equal(docLogs.length, 31, 'Only fresh catalogue creation history survives');
        assert(docLogs.every(log => log.action === 'create' && newIds.includes(log.entity_id)));
        assert.equal((await client.query('SELECT description FROM change_log WHERE id=$1', [financeLogId])).rows[0].description, 'Historial financiero que se conserva');
        assert.deepEqual(await snapshot(unchangedTables), unrelatedBefore, 'Employees, finance, purchase requisitions and document types remain byte-for-byte equal');
        for (const doc of documents) {
            const expected = expectedCatalogue!.find(template => template.key === doc.source_key)!;
            assert.equal(doc.folio, expected.code);
            assert.equal(doc.title, expected.title);
            assert.equal(doc.digital_kind, expected.kind);
            assert.equal(doc.area, expected.area);
            assert.equal(doc.priority_order, expected.priority);
            assert.equal(typeof doc.priority_order, 'number');
            assert.equal(typeof doc.source_is_example, 'boolean');
            assert.equal(doc.source_is_example, expected.sourceIsExample);
            assert.equal(doc.needs_adaptation, !!expected.needsAdaptation);
            assert.deepEqual(doc.source_files, expected.sourceFiles);
            assert.deepEqual(doc.template_schema, expected, 'JSONB preserves numbers, booleans, fields, tables, diagrams, and source metadata');
            const visibleAndSources = JSON.stringify({ title: doc.title, content: doc.content, objective: doc.objective,
                source_files: doc.source_files, template_schema: doc.template_schema });
            assert(!/canacintra|canacitra|Constructora Cuman|CUMAN|ITESM|instituto tecnol[oó]gico/i.test(visibleAndSources));
        }
        const catalogueBeforeRepeat = await snapshot();
        await rejected(replacementSql!, /catálogo cambió/, catalogueBeforeRepeat);
        // A stored capture must block even a newly prepared snapshot of the
        // current catalogue, and must retain its own immutable PDF reference.
        const document = documents.find(doc => doc.digital_kind === 'form')!;
        const entryId = randomUUID();
        await client.query(`INSERT INTO document_entries(id,document_id,folio,revision,template_version,template_revision,template_snapshot,values,status,
            created_by,created_by_name,updated_by,updated_by_name) VALUES($1,$2,'QA/2026/0001',1,'1.0',1,$3,'{}','draft',$4,'Empleado QA',$4,'Empleado QA')`,
            [entryId, document.id, document.template_schema, employeeId]);
        await client.query(`INSERT INTO document_entry_versions(entry_id,revision,template_version,template_revision,template_snapshot,values,status,pdf_path,sha256,pdf_size,created_by,created_by_name)
            VALUES($1,1,'1.0',1,$2,'{}','draft',$3,$4,100,$5,'Empleado QA')`,
            [entryId, document.template_schema, `entries/${entryId}/existing.pdf`, 'a'.repeat(64), employeeId]);
        const evidenceBefore = await snapshot(['document_entries', 'document_entry_versions']);
        await rejected(buildDigitalCatalogueSql(newIds), /Existen capturas digitales/, catalogueBeforeRepeat);
        assert.deepEqual(await snapshot(['document_entries', 'document_entry_versions']), evidenceBefore);
        console.log('PASS: ID/new-document guards; late-error rollback; full old-document/version/signature/request/history replacement; 31 unapproved drafts; literal SQL quoting; SMAA sanitization and JSON types; unrelated modules preserved; repeat/capture protection.');
    } finally { await cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
