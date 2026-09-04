/**
 * Aplica una migration de Supabase a la DB.
 *
 * Uso:
 *   npx tsx scripts/apply-migration.ts <filename>      (lee DB_URL de .env.local)
 *   DB_URL=postgresql://... npx tsx scripts/apply-migration.ts
 *   DB_URL=postgresql://... npx tsx scripts/apply-migration.ts <filename>
 *
 * Si no se pasa filename, toma la migration más reciente del directorio
 * `supabase/migrations/` (ordenada por nombre).
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

/**
 * Lee DB_URL de .env.local si no viene en el entorno.
 *
 * Así la cadena de conexión (que trae la contraseña de la base) no tiene que
 * ir en la línea de comandos, donde quedaría en el historial de la shell.
 * .env.local está en .gitignore.
 */
function resolveDbUrl(): string | undefined {
    if (process.env.DB_URL) return process.env.DB_URL;
    for (const file of ['.env.local', '.env']) {
        if (!existsSync(file)) continue;
        const match = readFileSync(file, 'utf-8').match(/^\s*DB_URL\s*=\s*(.+)$/m);
        if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
    return undefined;
}

const DB_URL = resolveDbUrl();
if (!DB_URL) {
    console.error('❌ Falta DB_URL. Ponla en .env.local (recomendado):');
    console.error('  DB_URL="postgresql://postgres:TU-PASSWORD@db.TU-PROYECTO.supabase.co:5432/postgres"');
    console.error('');
    console.error('  o pásala en el entorno:');
    console.error('  DB_URL="postgresql://..." npx tsx scripts/apply-migration.ts <archivo>');
    process.exit(1);
}

async function main() {
    const client = new Client({
        connectionString: DB_URL,
        // Supabase exige TLS. El pooler presenta un certificado que no valida
        // contra las CA del sistema, así que se cifra sin verificar la cadena
        // (es lo que documenta Supabase para conexiones directas).
        ssl: { rejectUnauthorized: false },
    });

    // Las migraciones que reparan datos reportan lo que hicieron con RAISE
    // NOTICE / RAISE WARNING. node-postgres los emite como evento y los tira
    // si nadie escucha, así que sin esto no te enteras de cuántas filas se
    // tocaron ni de cuáles quedaron huérfanas.
    client.on('notice', (n) => {
        const sev = (n.severity || 'NOTICE').toUpperCase();
        const prefix = sev === 'WARNING' ? '⚠️ ' : '   ';
        console.log(`${prefix}${sev}: ${n.message}`);
    });

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
