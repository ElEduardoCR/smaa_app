/**
 * Aplica la migration 20260729000000_po_supplier_nullable.sql a la DB.
 * Uso: DB_URL=postgresql://... npx tsx scripts/apply-migration.ts
 */
import { readFileSync } from 'fs';
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

    const migrationPath = 'supabase/migrations/20260729000000_po_supplier_nullable.sql';
    const sql = readFileSync(migrationPath, 'utf-8');
    console.log(`✓ Migration leída: ${migrationPath} (${sql.length} bytes)`);

    try {
        await client.query(sql);
        console.log('✓ Migration aplicada con éxito');
    } catch (e: any) {
        console.error('❌ Error aplicando migration:', e.message);
        process.exit(1);
    }

    // Verificar el cambio
    const res = await client.query(`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'purchase_orders' AND column_name IN ('supplier_id', 'notes')
        ORDER BY column_name;
    `);
    console.log('\n=== Estado actual de purchase_orders.supplier_id y notes ===');
    for (const row of res.rows) {
        console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    }

    await client.end();
}

main().catch((e) => {
    console.error('💥 Error fatal:', e);
    process.exit(2);
});
