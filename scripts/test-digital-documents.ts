import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createDigitalTestDatabase } from './digital-test-db';
import { documentTemplates } from '../src/lib/documents/catalog';
import type { DigitalTemplate } from '../src/lib/documents/schema';
import { initialDigitalValues } from '../src/lib/documents/schema';
import { readDigitalTemplate, validateDigitalValues } from '../src/lib/documents/validation';
import { generateDigitalPdf } from '../src/lib/documents/pdf';

async function main() {
    assert.equal(documentTemplates.length, 31, 'Every supplied source has a digital catalogue entry');
    assert.equal(new Set(documentTemplates.map(t => t.code)).size, 31, 'Document codes are unique');
    for (const template of documentTemplates) {
        assert(!template.code.includes('XX'), `${template.key} needs a final code`);
        validateDigitalValues(readDigitalTemplate(template), initialDigitalValues(template), false);
    }
    const sample: DigitalTemplate = { key: 'qa-digital', code: 'QA-F-01', title: 'Prueba de captura SMAA', kind: 'form', area: 'QA', priority: 1,
        sourceFiles: [], sourceIsExample: false, description: 'Prueba aislada', sections: [{ title: 'Datos', fields: [
            { key: 'nombre', label: 'Nombre', required: true }, { key: 'fecha', label: 'Fecha', type: 'date' },
            { key: 'numero', label: 'Cantidad', type: 'number', min: 0, max: 100 },
            { key: 'opcion', label: 'Opción', type: 'select', options: ['Sí', 'No'] },
            { key: 'firma', label: 'Firma opcional', type: 'signature' },
        ] }, { title: 'Detalle', table: { key: 'detalle', label: 'Detalle', minRows: 0, maxRows: 2,
            columns: [{ key: 'nombre', label: 'Nombre' }] } }] };
    const values = { nombre: 'Prueba con áéíóú y Ñ', fecha: '2026-11-17', numero: 0, opcion: 'Sí', detalle: [] };
    assert.equal(validateDigitalValues(sample, values, true).numero, 0);
    assert.throws(() => validateDigitalValues(sample, { ...values, nombre: '' }, true), /Completa/);
    assert.throws(() => validateDigitalValues(sample, { ...values, fecha: '2026-02-30' }, true), /fecha no válida/);
    assert.throws(() => validateDigitalValues(sample, { ...values, numero: Infinity }, false), /rango/);
    assert.throws(() => validateDigitalValues(sample, { ...values, opcion: 'Tal vez' }, false), /opción no válida/);
    assert.throws(() => validateDigitalValues(sample, { ...values, extra: 'injected' }, false), /no reconocido/);
    assert.throws(() => validateDigitalValues(sample, { ...values, firma: 'data:image/svg+xml;base64,AAAA' }, false), /firma válida/);
    assert.throws(() => validateDigitalValues(sample, { ...values, detalle: [{ nombre: '1' }, { nombre: '2' }, { nombre: '3' }] }, false), /cantidad de filas/);
    const supplier = documentTemplates.find(t => t.key === 'checklist-proveedor-potencial')!;
    const supplierValues = validateDigitalValues(supplier, initialDigitalValues(supplier), false);
    assert.equal(typeof (supplierValues.requisitos as { numero: string }[])[0].numero, 'string', 'Numeric fixed labels remain valid text on repeated saves');
    validateDigitalValues(supplier, supplierValues, false);
    const tampered = structuredClone(initialDigitalValues(supplier));
    (tampered.requisitos as { requisito: string }[])[0].requisito = 'Alterado';
    assert.throws(() => validateDigitalValues(supplier, tampered, false), /no se puede modificar/);
    const supplierFinal = { ...initialDigitalValues(supplier), proveedor: 'Proveedor QA', fecha: '2026-11-17', aprobado: 'No' };
    supplierFinal.requisitos = (supplierFinal.requisitos as Record<string, string>[]).map(row => ({ ...row, entregado: 'No aplica' }));
    validateDigitalValues(supplier, supplierFinal, true);
    assert.throws(() => validateDigitalValues(supplier, { ...supplierFinal, aprobado: '' }, true), /Proveedor aprobado/);
    const missingReview = structuredClone(supplierFinal);
    (missingReview.requisitos as Record<string, string>[])[0].entregado = '';
    assert.throws(() => validateDigitalValues(supplier, missingReview, true), /Entregado/);
    assert.throws(() => validateDigitalValues(supplier, { ...supplierFinal, aprobado: 'Sí' }, true), /nombre, fecha y firma/);
    const rdn = documentTemplates.find(t => t.key === 'registro-documento-nuevo')!;
    const rdnFinal = initialDigitalValues(rdn);
    for (const section of rdn.sections) for (const field of section.fields || []) if (field.required) {
        rdnFinal[field.key] = field.type === 'date' ? '2026-11-17' : field.type === 'select' ? field.options![0] : 'Prueba QA';
    }
    rdnFinal.aprobaciones = [{ requiere_aprobacion: 'No' }];
    validateDigitalValues(rdn, rdnFinal, true);
    assert.throws(() => validateDigitalValues(rdn, { ...rdnFinal, aprobaciones: [{}] }, true), /completa al menos/);
    assert.throws(() => validateDigitalValues(rdn, { ...rdnFinal, aprobaciones: [{ generador: 'Prueba QA' }] }, true), /Requiere aprobación/);
    assert.throws(() => validateDigitalValues(rdn, { ...rdnFinal, aprobaciones: [{ requiere_aprobacion: 'Sí' }] }, true), /aprobador, la fecha y su firma/);
    const pdfInput = { template: sample, values, folio: 'QA-F-01/2026/0001', templateVersion: '1.0', templateRevision: 1,
        revision: 1, status: 'draft' as const, authorName: 'Prueba QA', savedAt: '2026-11-17T16:00:00.000Z' };
    const pdf = generateDigitalPdf(pdfInput);
    assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');
    assert.equal(pdf.sha256, generateDigitalPdf(pdfInput).sha256, 'Identical saved evidence generates identical PDF bytes');

    const test = await createDigitalTestDatabase();
    const { client, roles } = test;
    const pool = new Pool({ host: 'localhost', port: 5432, database: test.database, max: 12 });
    try {
        const employeeId = (await client.query("INSERT INTO employees(full_name) VALUES('Prueba autorizada') RETURNING id")).rows[0].id;
        const otherId = (await client.query("INSERT INTO employees(full_name) VALUES('Otra persona') RETURNING id")).rows[0].id;
        const typeId = (await client.query("SELECT id FROM document_types WHERE code='FOR'")).rows[0].id;
        const documentId = (await client.query(`INSERT INTO documents(folio,type_id,title,content,source_key,digital_kind,template_schema)
            VALUES($1,$2,$3,'Contenido de prueba',$4,'form',$5) RETURNING id`, [sample.code, typeId, sample.title, sample.key, sample])).rows[0].id;
        const folios = await Promise.all(Array.from({ length: 20 }, () => pool.query('SELECT digital_next_entry_folio($1) AS folio', [documentId])));
        assert.equal(new Set(folios.map(r => r.rows[0].folio)).size, 20, 'Concurrent folios are unique');
        const entryId = randomUUID();
        const save = (opts: { expected?: number; status?: string; actor?: string; canEdit?: boolean; bytes?: number; schema?: DigitalTemplate; version?: string; templateRevision?: number; path?: string } = {}) =>
            pool.query('SELECT save_digital_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS result', [
                entryId, documentId, opts.expected ?? 0, folios[0].rows[0].folio, opts.version ?? '1.0', opts.templateRevision ?? 1, opts.schema ?? sample,
                values, opts.status ?? 'draft', opts.actor ?? employeeId, 'Prueba autorizada', opts.canEdit ?? false,
                opts.path ?? `entries/${entryId}/${randomUUID()}.pdf`, pdf.sha256, opts.bytes ?? pdf.bytes.length, '2026-11-17T16:00:00Z',
            ]);
        await client.query(`SET ROLE ${roles.service}`);
        assert.equal((await client.query('SELECT count(*)::int n FROM document_entries')).rows[0].n, 0);
        await client.query('RESET ROLE');
        assert.equal((await save()).rows[0].result.revision, 1);
        await assert.rejects(save({ expected: 1, actor: otherId }), /Sin permiso/);
        const parallel = await Promise.allSettled([save({ expected: 1 }), save({ expected: 1 })]);
        assert.equal(parallel.filter(r => r.status === 'fulfilled').length, 1, 'Concurrent edits cannot overwrite each other');
        assert.equal((await client.query('SELECT count(*)::int n FROM document_entry_versions WHERE entry_id=$1', [entryId])).rows[0].n, 2);
        await assert.rejects(save({ expected: 2, bytes: 0 }), /check constraint/);
        assert.equal((await client.query('SELECT revision FROM document_entries WHERE id=$1', [entryId])).rows[0].revision, 2, 'Failed PDF transaction rolls back the capture update');
        await assert.rejects(client.query('UPDATE document_entry_versions SET sha256=$1 WHERE entry_id=$2', ['a'.repeat(64), entryId]), /inmutable/);
        const edited = { ...sample, title: 'Contenido actualizado SMAA' };
        await client.query('SELECT update_digital_document_content($1,$2,$3,$4,$5,$6)', [documentId, 1, edited, 'Contenido revisado', 'Persona que edita', 'Revisión probada']);
        assert.equal((await client.query('SELECT document_snapshot FROM document_versions WHERE document_id=$1', [documentId])).rows[0].document_snapshot.folio, sample.code);
        await assert.rejects(save({ expected: 2 }), /formato cambió/);
        assert.equal((await client.query('SELECT template_snapshot FROM document_entries WHERE id=$1', [entryId])).rows[0].template_snapshot.title, sample.title);
        // Restore only this test document to exercise finalization separately.
        await client.query('UPDATE documents SET template_schema=$2,version=$3,revision=1 WHERE id=$1', [documentId, sample, '1.0']);
        assert.equal((await save({ expected: 2, status: 'finalized' })).rows[0].result.revision, 3);
        await assert.rejects(save({ expected: 3 }), /finalizada/);
        await assert.rejects(client.query('DELETE FROM document_entries WHERE id=$1', [entryId]), /finalizada/);
        await assert.rejects(client.query('DELETE FROM documents WHERE id=$1', [documentId]), /foreign key/);
        await client.query(`SET ROLE ${roles.anon}`);
        await assert.rejects(client.query('SELECT * FROM document_entries'), /permission denied/);
        await assert.rejects(client.query('SELECT digital_next_entry_folio($1)', [documentId]), /permission denied/);
        await client.query('RESET ROLE');
        const bucket = (await client.query("SELECT public,allowed_mime_types FROM storage.buckets WHERE id='digital-document-pdfs'")).rows[0];
        assert.equal(bucket.public, false);
        assert.deepEqual(bucket.allowed_mime_types, ['application/pdf']);
        console.log('PASS: 31 source schemas; strict values; readable PDF engine; atomic folios; concurrency; PDF rollback; version snapshots; immutable evidence; authorization; private bucket.');
    } finally { await pool.end(); await test.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
