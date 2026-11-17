/** Isolated local DB test. Never reads production configuration or credentials. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import ts from 'typescript';
import { createDigitalTestDatabase } from './digital-test-db';
import type * as DocumentAccessModule from '../src/app/actions/documentAccess';

/** Run the real action implementation, replacing only Next/auth/DB boundaries. */
function loadDocumentActions(db: unknown, employeeId: string): typeof DocumentAccessModule {
    const filename = resolve('src/app/actions/documentAccess.ts');
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
        fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const dependencies: Record<string, unknown> = {
        'next/cache': { revalidatePath: () => undefined },
        '@/lib/session': { getSession: async () => ({ employeeId, role: 'master', permissions: [] }) },
        '@/lib/permissions': { can: () => true },
        '@/lib/supabaseServer': { getServerSupabase: () => db },
        '@/lib/documents/validation': { assertDigitalId: (id: string) => assert.match(id, /^[a-f0-9-]{36}$/i) },
        '@/lib/documents/approvalStorage': {},
    };
    const loaded = { exports: {} };
    const requireMock = (name: string) => {
        if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected isolated dependency: ${name}`);
        return dependencies[name];
    };
    new Function('require', 'module', 'exports', source)(requireMock, loaded, loaded.exports);
    return loaded.exports as typeof DocumentAccessModule;
}

async function main() {
    const test = await createDigitalTestDatabase();
    const { client, roles } = test;
    const pool = new Pool({ host: 'localhost', port: 5432, database: test.database, max: 10 });
    try {
        const sql = readFileSync('supabase/migrations/20261117173320_private_controlled_document_access.sql', 'utf8')
            .replace(/\banon\b/g, roles.anon).replace(/\bauthenticated\b/g, roles.authenticated).replace(/\bservice_role\b/g, roles.service);
        await client.query(`CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
            ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
            CREATE POLICY legacy_storage_access ON storage.objects FOR ALL USING(true) WITH CHECK(true);
            GRANT USAGE ON SCHEMA storage TO ${roles.anon},${roles.authenticated},${roles.service};
            GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO ${roles.anon},${roles.authenticated},${roles.service};
            GRANT SELECT,INSERT,UPDATE,DELETE ON documents,document_versions,document_signatures,document_requests,change_log
                TO ${roles.anon},${roles.authenticated};`);
        await client.query(sql);
        const typeId = (await client.query("SELECT id FROM document_types WHERE code='FOR'")).rows[0].id;
        const employeeId = (await client.query("INSERT INTO employees(full_name,role) VALUES('Prueba autorizada','master') RETURNING id")).rows[0].id;
        const payload = { type_id: typeId, title: 'Documento privado QA', content: 'Contenido reservado de prueba', version: '1.0' };
        const create = (extra = {}) => client.query('SELECT save_legacy_controlled_document(NULL,0,$1,$2) AS result', [{ ...payload, ...extra }, 'Autor desde sesión']);
        const document = (await create()).rows[0].result;
        const requestId = (await client.query(`INSERT INTO document_requests(type,target_document_id,title,reason,payload,status,requested_by)
            VALUES('change',$1,'Solicitud privada QA','Motivo reservado',$2,'pending_top_mgmt',$3) RETURNING id`,
            [document.id, { ...payload, base_revision: 1 }, employeeId])).rows[0].id;
        await client.query('INSERT INTO document_versions(document_id,version,revision,title,content) VALUES($1,$2,1,$3,$4)', [document.id, '0.9', 'Versión reservada QA', 'Texto anterior reservado']);
        await client.query(`INSERT INTO document_signatures(document_id,version,signer_name,signature_url,purpose)
            VALUES($1,'0.9','Firmante QA','storage://controlled-document-signatures/test/old.png','approval')`, [document.id]);
        for (const entity of ['document', 'document_version', 'document_request', 'document_entry', 'work_order']) {
            await client.query("INSERT INTO change_log(entity_type,entity_id,action,description,source) VALUES($1,$2,'create',$3,'test')", [entity, document.id, `Evidencia ${entity}`]);
        }
        await client.query("INSERT INTO storage.objects(bucket_id,name) VALUES('controlled-document-signatures','test/private.png'),('purchase_files','public-legacy.pdf')");
        for (const role of [roles.anon, roles.authenticated]) {
            await client.query(`SET ROLE ${role}`);
            for (const table of ['documents', 'document_versions', 'document_signatures', 'document_requests']) {
                await assert.rejects(client.query(`SELECT * FROM ${table}`), /permission denied/);
                await assert.rejects(client.query(`DELETE FROM ${table}`), /permission denied/);
            }
            const visibleEntities = (await client.query('SELECT entity_type FROM change_log ORDER BY entity_type')).rows.map(row => row.entity_type);
            assert(visibleEntities.includes('work_order'));
            assert(visibleEntities.every(entity => ['work_order', 'purchase'].includes(entity)));
            await assert.rejects(client.query("INSERT INTO change_log(entity_type,action,source) VALUES('document','create','test')"), /row-level security/);
            await client.query("INSERT INTO change_log(entity_type,action,source) VALUES('purchase','create','test')");
            assert.equal((await client.query("UPDATE change_log SET description='blocked' WHERE entity_type='document' RETURNING id")).rowCount, 0);
            assert.equal((await client.query("SELECT * FROM storage.objects WHERE bucket_id='controlled-document-signatures'")).rowCount, 0);
            assert.equal((await client.query("SELECT * FROM storage.objects WHERE bucket_id='purchase_files'")).rowCount, 1);
            await assert.rejects(client.query("INSERT INTO storage.objects(bucket_id,name) VALUES('controlled-document-signatures','blocked.png')"), /row-level security/);
            await assert.rejects(client.query('SELECT save_legacy_controlled_document(NULL,0,$1,$2)', [payload, 'Forged']), /permission denied/);
            await assert.rejects(client.query('SELECT sign_controlled_document($1,1,$2,$3,$4)', [document.id, 'Forged', 'Director', 'storage://controlled-document-signatures/test/private.png']), /permission denied/);
            await assert.rejects(client.query('SELECT publish_document_request_atomic($1,$2,$3)', [requestId, employeeId, 'Forged']), /permission denied/);
            await client.query('RESET ROLE');
        }
        // Restrictive RLS still protects data if a future table grant is added.
        await client.query(`GRANT SELECT,INSERT,UPDATE ON documents TO ${roles.anon}`);
        await client.query(`SET ROLE ${roles.anon}`);
        assert.equal((await client.query('SELECT * FROM documents')).rowCount, 0);
        assert.equal((await client.query("UPDATE documents SET title='blocked' RETURNING id")).rowCount, 0);
        await assert.rejects(client.query("INSERT INTO documents(folio,type_id,title,content) VALUES('BAD-01',$1,'blocked','blocked')", [typeId]), /row-level security/);
        await client.query('RESET ROLE');
        await client.query(`SET ROLE ${roles.service}`);
        assert.equal((await client.query('SELECT * FROM documents')).rowCount, 1);
        assert.equal((await client.query('SELECT * FROM document_requests')).rowCount, 1);
        assert.equal((await client.query('SELECT * FROM document_signatures')).rowCount, 1);
        const saved = (await client.query('SELECT save_legacy_controlled_document($1,1,$2,$3) AS result', [document.id, { ...payload, title: 'Documento actualizado QA' }, 'Editor desde sesión'])).rows[0].result;
        assert.equal(saved.id, document.id); assert.equal(saved.folio, document.folio); assert.equal(saved.version, '1.1');
        const current = (await client.query('SELECT * FROM documents WHERE id=$1', [document.id])).rows[0];
        assert.equal(current.revision, 2); assert.equal(current.created_by, 'Autor desde sesión'); assert.equal(current.status, 'draft');
        const snapshot = (await client.query('SELECT document_snapshot,changed_by FROM document_versions WHERE document_id=$1 AND version=$2', [document.id, '1.0'])).rows[0];
        assert.equal(snapshot.document_snapshot.content, payload.content); assert.equal(snapshot.changed_by, 'Editor desde sesión');
        await assert.rejects(client.query('SELECT save_legacy_controlled_document($1,1,$2,$3)', [document.id, payload, 'Editor']), /documento cambió/);
        const beforeBadSave = (await client.query('SELECT count(*)::integer n FROM document_versions')).rows[0].n;
        await assert.rejects(client.query('SELECT save_legacy_controlled_document($1,2,$2,$3)', [document.id, { ...payload, next_review_date: 'invalid' }, 'Editor']), /invalid input syntax/);
        assert.equal((await client.query('SELECT revision FROM documents WHERE id=$1', [document.id])).rows[0].revision, 2);
        assert.equal((await client.query('SELECT count(*)::integer n FROM document_versions')).rows[0].n, beforeBadSave);
        await assert.rejects(client.query('SELECT sign_controlled_document($1,2,$2,$3,$4)', [document.id, 'Firmante desde sesión', 'Dirección', 'https://public.invalid/signature.png']), /Firma de aprobación/);
        const uri = 'storage://controlled-document-signatures/test/current.png';
        await client.query('SELECT sign_controlled_document($1,2,$2,$3,$4)', [document.id, 'Firmante desde sesión', 'Dirección', uri]);
        const approved = (await client.query('SELECT * FROM documents WHERE id=$1', [document.id])).rows[0];
        assert.equal(approved.status, 'approved'); assert.equal(approved.approval_name, 'Firmante desde sesión'); assert.equal(approved.approval_signature_url, uri);
        await client.query('RESET ROLE');
        // The service-only publication RPC preserves a private signature URI.
        await client.query(`UPDATE document_requests SET status='approved',top_mgmt_approver=$2,top_mgmt_approved_at=now(),
            top_mgmt_signature_url=$3,top_mgmt_approver_name='Autoridad QA',top_mgmt_approver_role='Dirección',
            payload=jsonb_set(payload,'{base_revision}','2') WHERE id=$1`, [requestId, employeeId, uri]);
        await client.query(`SET ROLE ${roles.service}`);
        await client.query('SELECT publish_document_request_atomic($1,$2,$3)', [requestId, employeeId, 'Publicador QA']);
        assert.equal((await client.query('SELECT approval_signature_url FROM documents WHERE id=$1', [document.id])).rows[0].approval_signature_url, uri);

        // Real state actions against the isolated DB: previous state and revision
        // are predicates in the same UPDATE, so a stale request cannot revive it.
        const dbAdapter = {
            from(table: string) {
                assert.equal(table, 'documents');
                let patch: Record<string, unknown> = {};
                const conditions: { key: string; values: unknown[]; list: boolean }[] = [];
                const query = {
                    update(value: Record<string, unknown>) { patch = value; return query; },
                    eq(key: string, value: unknown) { conditions.push({ key, values: [value], list: false }); return query; },
                    in(key: string, values: unknown[]) { conditions.push({ key, values, list: true }); return query; },
                    select(columns: string) { assert.equal(columns, 'id'); return query; },
                    async single() {
                        const values: unknown[] = [];
                        const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
                        const assignments = Object.entries(patch).map(([key, value]) => { assert.match(key, /^[a-z_]+$/); return `${key}=${bind(value)}`; });
                        const filters = conditions.map(condition => {
                            assert.match(condition.key, /^[a-z_]+$/);
                            return condition.list ? `${condition.key} IN (${condition.values.map(bind).join(',')})` : `${condition.key}=${bind(condition.values[0])}`;
                        });
                        try {
                            const result = await client.query(`UPDATE documents SET ${assignments.join(',')} WHERE ${filters.join(' AND ')} RETURNING id`, values);
                            return { data: result.rows[0] || null, error: null };
                        } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : 'Isolated DB failure' } }; }
                    },
                };
                return query;
            },
        };
        const actions = loadDocumentActions(dbAdapter, employeeId);
        const controlled = (await client.query('SELECT save_legacy_controlled_document(NULL,0,$1,$2) AS result', [{ ...payload, title: 'Control de estados QA' }, 'Autor QA'])).rows[0].result;
        const stateInput = { documentId: controlled.id, expectedRevision: 1 };
        const currentState = async () => (await client.query('SELECT status FROM documents WHERE id=$1', [controlled.id])).rows[0].status;
        await assert.rejects(actions.changeControlledDocumentStatusAction({ ...stateInput, status: 'pending_obsolete' }));
        await assert.rejects(actions.obsoleteControlledDocumentAction({ ...stateInput, reason: 'No es vigente' }));
        assert.equal(await currentState(), 'draft');
        await actions.changeControlledDocumentStatusAction({ ...stateInput, status: 'in_review' });
        assert.equal(await currentState(), 'in_review');
        await assert.rejects(actions.changeControlledDocumentStatusAction({ ...stateInput, status: 'in_review' }));
        await client.query('SELECT sign_controlled_document($1,1,$2,$3,$4)', [controlled.id, 'Firmante QA', 'Dirección', uri]);
        await actions.changeControlledDocumentStatusAction({ ...stateInput, status: 'pending_obsolete' });
        assert.equal(await currentState(), 'pending_obsolete');
        await assert.rejects(client.query('SELECT save_legacy_controlled_document($1,1,$2,$3)', [controlled.id, payload, 'Editor QA']), /documento obsoleto/);
        await actions.obsoleteControlledDocumentAction({ ...stateInput, reason: 'Sustituido en prueba aislada' });
        for (const status of ['draft', 'in_review', 'pending_obsolete']) {
            await assert.rejects(actions.changeControlledDocumentStatusAction({ ...stateInput, status }));
            assert.equal(await currentState(), 'obsolete');
        }
        await assert.rejects(client.query('SELECT sign_controlled_document($1,1,$2,$3,$4)', [controlled.id, 'Firmante QA', 'Dirección', uri]), /Solo se puede aprobar/);
        await assert.rejects(client.query('SELECT save_legacy_controlled_document($1,1,$2,$3)', [controlled.id, payload, 'Editor QA']), /documento obsoleto/);
        const schema = { key: 'qa-controlled-state', code: controlled.folio, title: 'Control QA', sections: [] };
        await client.query('UPDATE documents SET template_schema=$2,source_key=$3 WHERE id=$1', [controlled.id, schema, schema.key]);
        await assert.rejects(client.query('SELECT update_digital_document_content($1,1,$2,$3,$4,$5)',
            [controlled.id, schema, 'Contenido bloqueado QA', 'Editor QA', 'Cambio bloqueado QA']), /documento obsoleto/);
        assert.equal(await currentState(), 'obsolete');
        await client.query('RESET ROLE');
        const created = await Promise.all(Array.from({ length: 20 }, (_, i) => pool.query('SELECT save_legacy_controlled_document(NULL,0,$1,$2) AS result', [{ ...payload, title: `Documento concurrente ${i}` }, 'Autor QA'])));
        assert.equal(new Set(created.map(result => result.rows[0].result.folio)).size, 20);
        assert.equal((await client.query("SELECT public FROM storage.buckets WHERE id='controlled-document-signatures'")).rows[0].public, false);
        console.log('PASS: private documents/versions/signatures/requests; restrictive RLS despite grants; confidential logs isolated; other-module logs/storage preserved; service-only read/save/sign/publish; atomic legacy revision/rollback; private signature URI; concurrent folios; real action state transitions; obsolete documents cannot revive through state actions, signatures or either editor.');
    } finally { await pool.end(); await test.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
