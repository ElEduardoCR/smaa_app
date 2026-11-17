import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDigitalTestDatabase } from './digital-test-db';

async function main() {
    const { client, roles, cleanup } = await createDigitalTestDatabase();
    try {
        const approverId = randomUUID();
        const publisherId = randomUUID();
        await client.query(`INSERT INTO employees(id,full_name,role) VALUES($1,'Dirección que firma','top_management'),($2,'Usuario que publica','master')`, [approverId, publisherId]);
        await client.query(`GRANT SELECT, INSERT ON document_signatures TO ${roles.service}`);
        const type = (await client.query(`SELECT id FROM document_types WHERE code='FOR'`)).rows[0].id;
        const schema = {
            key: 'test-controlado', code: 'ISO-F-03', title: 'Documento original', kind: 'form', area: 'ISO', priority: 3,
            sourceFiles: ['ISO-F-XX original.xlsx'], sourceIsExample: false, description: 'Formato de prueba',
            sections: [
                { title: 'Texto original', paragraphs: ['Instrucción de origen'] },
                { title: 'Campos', fields: [{key:'responsable',label:'Responsable',required:true}] },
                { title: 'Tabla', table: {key:'tabla',label:'Tabla',columns:[{key:'dato',label:'Dato'}],initialRows:[{dato:''}]} },
                { title: 'Mapa', flow:{nodes:[{id:'a',label:'Inicio',x:0,y:0,width:100,height:40}],edges:[],width:100,height:40} },
            ],
        };
        const docId = randomUUID();
        await client.query(`INSERT INTO documents(id,folio,type_id,title,content,version,revision,status,source_key,digital_kind,area,priority_order,
            source_files,source_is_example,needs_adaptation,template_schema,approval_name,approval_role,approval_signature_url,approval_signed_at)
            VALUES($1,'ISO-F-03',$2,'Documento original','Texto original','1.0',1,'approved','test-controlado','form','ISO',3,
                '["ISO-F-XX original.xlsx"]',false,false,$3,'Firmante anterior','Dirección','https://example.invalid/old.png',now())`, [docId,type,JSON.stringify(schema)]);
        const oldDocument = (await client.query('SELECT to_jsonb(d) AS snapshot FROM documents d WHERE id=$1',[docId])).rows[0].snapshot;
        const makeRequest = async (payload: Record<string,unknown>, signed = true, targetId: string | null = docId) => {
            const id = randomUUID();
            await client.query(`INSERT INTO document_requests(id,type,target_document_id,title,reason,payload,status,requested_by,
                top_mgmt_approver,top_mgmt_approved_at,top_mgmt_signature_url,top_mgmt_approver_name,top_mgmt_approver_role)
                VALUES($1,$2,$3,$4,'Justificación de prueba',$5,'approved',$6,$6,now(),$7,$8,'Dirección')`,
                [id,targetId?'change':'new',targetId,payload.title,JSON.stringify(payload),approverId,
                    signed?'https://example.invalid/signature.png':null,signed?'Dirección que firma':null]);
            return id;
        };
        const publish = async (requestId: string) => {
            await client.query(`SET ROLE ${roles.service}`);
            try { return (await client.query('SELECT publish_document_request_atomic($1,$2,$3) AS result',[requestId,publisherId,'Usuario que publica'])).rows[0].result; }
            finally { await client.query('RESET ROLE'); }
        };
        const requestId = await makeRequest({title:'Documento revisado',content:'Texto aprobado actualizado',version:'1.1',base_revision:1});
        const published = await publish(requestId);
        assert.equal(published.document_id,docId);
        const current = (await client.query('SELECT * FROM documents WHERE id=$1',[docId])).rows[0];
        assert.equal(current.folio,'ISO-F-03'); assert.equal(current.source_key,'test-controlado'); assert.equal(current.revision,2); assert.equal(current.version,'1.1');
        assert.equal(current.approval_name,'Dirección que firma'); assert.equal(current.approval_signature_url,'https://example.invalid/signature.png');
        assert.equal(current.template_schema.code,'ISO-F-03'); assert.equal(current.template_schema.key,'test-controlado');
        assert.deepEqual(current.template_schema.sections.slice(1),schema.sections.slice(1));
        assert.deepEqual(current.template_schema.sections[0].paragraphs,['Texto aprobado actualizado']);
        const snapshot = (await client.query('SELECT document_snapshot,template_schema FROM document_versions WHERE document_id=$1',[docId])).rows[0];
        assert.deepEqual(snapshot.document_snapshot,oldDocument); assert.deepEqual(snapshot.template_schema,schema);
        assert.equal((await client.query('SELECT signer_name FROM document_signatures WHERE document_id=$1',[docId])).rows[0].signer_name,'Dirección que firma');
        assert.equal((await client.query('SELECT resulting_document_id FROM document_requests WHERE id=$1',[requestId])).rows[0].resulting_document_id,docId);
        assert.equal((await client.query("SELECT count(*)::int AS n FROM documents WHERE source_key='test-controlado'")).rows[0].n,1);

        const secondRequest = await makeRequest({title:'Documento segunda revisión',content:'Segundo cambio',version:'1.2',base_revision:2});
        assert.equal((await publish(secondRequest)).document_id,docId);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM document_versions WHERE document_id=$1',[docId])).rows[0].n,2);
        const latestSnapshot = (await client.query('SELECT document_snapshot FROM document_versions WHERE document_id=$1 AND revision=2',[docId])).rows[0].document_snapshot;
        assert.equal(latestSnapshot.folio,'ISO-F-03'); assert.equal(latestSnapshot.approval_name,'Dirección que firma'); assert.equal(latestSnapshot.template_schema.title,'Documento revisado');

        const unsigned = await makeRequest({title:'Sin firma',content:'No publicar',version:'1.3',base_revision:3},false);
        await assert.rejects(publish(unsigned),/firmar/);
        const stale = await makeRequest({title:'Versión desactualizada',content:'No publicar',version:'1.3',base_revision:1});
        await assert.rejects(publish(stale),/cambió/);
        const invalid = await makeRequest({title:'Fecha inválida',content:'No publicar',version:'1.3',base_revision:3,next_review_date:'invalid-date'});
        await assert.rejects(publish(invalid),/date|fecha/i);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM document_versions WHERE document_id=$1',[docId])).rows[0].n,2,'Late failure must roll back snapshot');
        assert.equal((await client.query('SELECT revision FROM documents WHERE id=$1',[docId])).rows[0].revision,3);
        assert.equal((await client.query('SELECT status FROM document_requests WHERE id=$1',[invalid])).rows[0].status,'approved');

        const newRequest = await makeRequest({title:'Documento nuevo',content:'Contenido de documento nuevo',version:'1.0'},true,null);
        const newResult = await publish(newRequest);
        const newDocument = (await client.query('SELECT folio,type_id,approval_name FROM documents WHERE id=$1',[newResult.document_id])).rows[0];
        assert.match(newDocument.folio,/^FOR-\d+$/); assert.equal(newDocument.type_id,type); assert.equal(newDocument.approval_name,'Dirección que firma');
        await assert.rejects(publish(newRequest),/no está aprobada/);
        await client.query(`SET ROLE ${roles.anon}`);
        try { await assert.rejects(client.query('SELECT publish_document_request_atomic($1,$2,$3)',[newRequest,publisherId,'No autorizado']),/permission denied/); }
        finally { await client.query('RESET ROLE'); }
        console.log('PASS: stable ID/code through v1/v2, complete snapshots, structure preservation, real approver, signed publication, stale/unsigned/late-error rollback, new folio, duplicate publish, anon denied');
    } finally { await cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
