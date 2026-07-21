// Seed script main: inserts the 14 ISO 9001:2015 procedure documents into Supabase.
// Run with:  node scripts/seed-iso-procedures.mjs
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { proceduresPart2 } from './iso-procedures-part2.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '..', '.env.local');

if (!existsSync(ENV_PATH)) {
    console.error(`❌ .env.local not found at ${ENV_PATH}`);
    process.exit(1);
}

const env = {};
for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('❌ Missing Supabase env vars in .env.local');
    process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Part 1 procedures (imported from part1 file)
import { readFileSync as readFS } from 'fs';
const part1Content = readFS(join(__dirname, 'iso-procedures-part1.mjs'), 'utf-8');
// Extract procedures array from part1 (between const procedures = [ and ];)
const part1Match = part1Content.match(/const procedures = \[([\s\S]*?)\n\];/);
if (!part1Match) {
    console.error('❌ Could not extract procedures from part1 file');
    process.exit(1);
}
const proceduresPart1 = eval(`[${part1Match[1]}]`);

const allProcedures = [...proceduresPart1, ...proceduresPart2];

// -----------------------------------------------------------------
// Generate a small PNG signature dataURL and upload it
// We use a 300x80 transparent PNG with a hand-drawn-like "Aprobado" line.
// For simplicity, we generate a base64-encoded minimal PNG with the text
// rendered as a 1px-tall line + dots pattern.
// -----------------------------------------------------------------
import { Buffer } from 'buffer';
import crypto from 'crypto';

// Use the public folder to host a generic approval signature image.
// We embed a tiny SVG converted to data URL approach instead.
const SIG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">
  <path d="M10 60 Q 40 20 70 50 T 130 50 T 190 40 T 250 55 T 310 45" stroke="#10b981" stroke-width="3" fill="none" stroke-linecap="round"/>
  <text x="10" y="75" font-family="cursive" font-size="11" fill="#10b981">Aprobado digitalmente</text>
</svg>`;

const sigDataUrl = `data:image/svg+xml;base64,${Buffer.from(SIG_SVG).toString('base64')}`;

async function uploadSignature(prefix) {
    // Convert data URL to blob
    const base64 = sigDataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const blob = new Blob([buffer], { type: 'image/svg+xml' });
    const path = `signatures/${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.svg`;
    const { error } = await supabase.storage.from('signatures').upload(path, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/svg+xml',
    });
    if (error) throw error;
    const { data } = supabase.storage.from('signatures').getPublicUrl(path);
    return data.publicUrl;
}

// -----------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------
async function main() {
    console.log(`\n📚 Inserting ${allProcedures.length} ISO 9001:2015 procedure documents...\n`);

    // 1) Verify document type "PRO" exists
    const { data: proType, error: typeErr } = await supabase
        .from('document_types')
        .select('id, code, name, prefix')
        .eq('code', 'PRO')
        .single();
    if (typeErr || !proType) {
        console.error('❌ Procedure type (PRO) not found. Run the main migration first.');
        process.exit(1);
    }
    console.log(`✓ Procedure type found: ${proType.name} (prefix: ${proType.prefix})`);

    // 2) Check which procedures already exist
    const { data: existing } = await supabase
        .from('documents')
        .select('folio, title')
        .like('folio', 'PRO-%');
    const existingFolios = new Set((existing || []).map(d => d.folio));
    const existingTitles = new Map((existing || []).map(d => [d.title, d.folio]));
    if (existing && existing.length > 0) {
        console.log(`\n⚠  ${existing.length} procedure(s) already exist. They will be skipped.`);
        for (const e of existing) console.log(`   · ${e.folio} — ${e.title}`);
        console.log('');
    }

    // 3) Upload a generic approval signature
    console.log('Uploading approval signature...');
    const sigUrl = await uploadSignature('iso_approval');
    console.log(`✓ Signature uploaded: ${sigUrl.slice(0, 60)}…\n`);

    const today = new Date().toISOString().slice(0, 10);
    let inserted = 0, skipped = 0, errors = 0;

    for (const proc of allProcedures) {
        if (existingTitles.has(proc.title)) {
            console.log(`  ⏭  ${proc.title} (already exists as ${existingTitles.get(proc.title)})`);
            skipped++;
            continue;
        }

        try {
            // Get next folio
            const { data: folioData, error: folioErr } = await supabase.rpc('next_document_folio', { type_prefix: proType.prefix });
            if (folioErr) throw folioErr;
            const folio = folioData || `${proType.prefix}-${String(inserted + skipped + 1).padStart(3, '0')}`;

            const nextReview = new Date();
            nextReview.setMonth(nextReview.getMonth() + (proc.nextReviewMonths || 12));

            const payload = {
                folio,
                type_id: proType.id,
                title: proc.title,
                objective: proc.objective,
                scope: proc.scope,
                definitions: proc.definitions,
                responsibilities: proc.responsibilities,
                content: proc.content,
                document_references: proc.document_references,
                records: proc.records,
                keywords: proc.keywords,
                version: '1.0',
                revision: 1,
                status: 'approved',
                effective_date: today,
                next_review_date: nextReview.toISOString().slice(0, 10),
                created_by: 'Sistema (Mavis / SGC bootstrap)',
                approval_name: proc.approvedBy,
                approval_role: proc.approvedRole,
                approval_signature_url: sigUrl,
                approval_signed_at: new Date().toISOString(),
            };

            const { data: doc, error: insErr } = await supabase
                .from('documents')
                .insert([payload])
                .select()
                .single();
            if (insErr) throw insErr;

            // Save initial version snapshot
            await supabase.from('document_versions').insert([{
                document_id: doc.id,
                version: '1.0',
                revision: 1,
                title: proc.title,
                objective: proc.objective,
                scope: proc.scope,
                definitions: proc.definitions,
                responsibilities: proc.responsibilities,
                content: proc.content,
                document_references: proc.document_references,
                records: proc.records,
                keywords: proc.keywords,
                change_summary: 'Versión inicial (creada en bootstrap del SGC)',
                changed_by: 'Sistema (Mavis / SGC bootstrap)',
            }]);

            // Save approval signature
            await supabase.from('document_signatures').insert([{
                document_id: doc.id,
                version: '1.0',
                signer_name: proc.approvedBy,
                signer_role: proc.approvedRole,
                signature_url: sigUrl,
                purpose: 'approval',
            }]);

            console.log(`  ✓ ${folio} — ${proc.title}`);
            inserted++;
        } catch (e) {
            console.error(`  ✗ ${proc.title}: ${e.message || e}`);
            errors++;
        }
    }

    console.log(`\n✅ Done. ${inserted} inserted, ${skipped} skipped, ${errors} errors.`);
    console.log(`\nView them at:  http://localhost:3000/documents\n`);

    process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
