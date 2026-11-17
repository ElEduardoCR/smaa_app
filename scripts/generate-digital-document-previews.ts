import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { documentTemplates } from '../src/lib/documents/catalog';
import { initialDigitalValues } from '../src/lib/documents/schema';
import { generateDigitalPdf } from '../src/lib/documents/pdf';
import { validateDigitalValues } from '../src/lib/documents/validation';

const output = resolve(process.argv[2] || '/tmp/smaa-docs-review/pdfs');
mkdirSync(output, { recursive: true });
const manifest = documentTemplates.map((template, index) => {
    const values = validateDigitalValues(template, initialDigitalValues(template), false);
    const pdf = generateDigitalPdf({ template, values, folio: `${template.code} · EN BLANCO`,
        templateVersion: '1.0', templateRevision: 1, revision: 0, status: 'blank',
        authorName: 'Sin captura', savedAt: '2026-11-17T16:00:00.000Z' });
    const path = resolve(output, `${String(index + 1).padStart(2, '0')}-${template.code}-${template.key}.pdf`);
    writeFileSync(path, pdf.bytes);
    return { code: template.code, key: template.key, title: template.title, pages: pdf.pageCount, bytes: pdf.bytes.length, sha256: pdf.sha256, path };
});
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ documents: manifest.length, pages: manifest.reduce((sum, doc) => sum + doc.pages, 0), output }, null, 2));
