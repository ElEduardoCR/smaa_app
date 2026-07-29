/**
 * Aplica una migration de Supabase a la DB.
 *
 * Uso:
 *   DB_URL=postgresql://... npx tsx scripts/apply-migration.ts
 *   DB_URL=postgresql://... npx tsx scripts/apply-migration.ts <filename>
 *
 * Si no se pasa filename, toma la migration más reciente del directorio
 * `supabase/migrations/` (ordenada por nombre).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
    console.error('❌ Falta DB_URL. Ejemplo:');
    console.error('  $env:DB_URL = "postgresql://postgres:xxx@host:5432/postgres"');
    console.error('  npx tsx scripts/apply-migration.ts');
    process.exit(1);
}

async function main() {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    console.log('✓ Conectado a la DB');

    const migrationsDir = 'supabase/migrations';
    let targetFile: string;
    if (process.argv[2]) {
        targetFile = process.argv[2];
    } else {
        const files = readdirSync(migrationsDir)
            .filter((f) => f.endsWith('.sql'))
            .sort();
        if (files.length === 0) {
            console.error(`❌ No hay migrations en ${migrationsDir}`);
            process.exit(1);
        }
        targetFile = files[files.length - 1];
    }

    const fullPath = join(migrationsDir, targetFile);
    const sql = readFileSync(fullPath, 'utf-8');
    console.log(`✓ Migration: ${fullPath} (${sql.length} bytes)`);

    try {
        await client.query(sql);
        console.log('✓ Migration aplicada con éxito');
    } catch (e: any) {
        console.error('❌ Error aplicando migration:', e.message);
        process.exit(1);
    }

    // Mostrar verificación para las últimas migrations conocidas
    if (targetFile === '20260729000000_po_supplier_nullable.sql') {
        const res = await client.query(`
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'purchase_orders'
              AND column_name IN ('supplier_id', 'notes')
            ORDER BY column_name;
        `);
        console.log('\n=== Estado actual de purchase_orders.supplier_id y notes ===');
        for (const row of res.rows) {
            console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        }
    } else if (targetFile === '20260729010000_add_is_active.sql') {
        const res = await client.query(`
            SELECT table_name, column_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('clients', 'suppliers', 'employees', 'purchase_orders')
              AND column_name = 'is_active'
            ORDER BY table_name;
        `);
        console.log('\n=== Estado de is_active ===');
        for (const row of res.rows) {
            console.log(`  ${row.table_name}.${row.column_name}: nullable=${row.is_nullable}`);
        }
    }

    await client.end();
}

main().catch((e) => {
    console.error('💥 Error fatal:', e);
    process.exit(2);
});
