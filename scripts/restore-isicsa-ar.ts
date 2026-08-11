/**
 * ===========================================================================
 * restore-isicsa-ar.ts
 * ===========================================================================
 *
 * Restaura las ar_invoices de ISICSA desde un JSON de respaldo
 * generado por update-isicsa-ar-*.ts.
 *
 * Estrategia:
 *   1) Marca todas las ar_invoices activas del cliente ISICSA como
 *      is_active = false (soft-delete).
 *   2) Reactiva los registros del respaldo (is_active = true) con los
 *      mismos datos originales.
 *
 * Los IDs del respaldo se preservan con UPSERT, así que las referencias
 * externas (pagos, evidencia) siguen apuntando al mismo UUID.
 *
 * Uso:
 *   DB_URL=postgresql://... npx tsx scripts/restore-isicsa-ar.ts <archivo.json>
 * ===========================================================================
 */

import { Client } from 'pg';
import { readFileSync, existsSync } from 'fs';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
    console.error('❌ Falta DB_URL');
    process.exit(1);
}

const sb = new Client({ connectionString: DB_URL });
const ISICSA_ID = 6;
const backupFile = process.argv[2];

if (!backupFile) {
    console.error('❌ Especifica el archivo de respaldo:');
    console.error('   npx tsx scripts/restore-isicsa-ar.ts scripts/backups/isicsa-ar-backup-XXXXX.json');
    process.exit(1);
}

if (!existsSync(backupFile)) {
    console.error(`❌ No existe: ${backupFile}`);
    process.exit(1);
}

(async () => {
    try {
        await sb.connect();
        console.log('✓ Conectado a la DB');

        const backup = JSON.parse(readFileSync(backupFile, 'utf-8'));
        console.log(`✓ Respaldo cargado: ${backupFile}`);
        console.log(`  Fecha del respaldo: ${backup.backup_date}`);
        console.log(`  Cliente:            ${backup.client_name} (id=${backup.client_id})`);
        console.log(`  Registros:          ${backup.invoices.length}`);
        console.log('');

        const mRes = await sb.query(`SELECT id FROM employees WHERE role = 'master' ORDER BY created_at LIMIT 1`);
        if (mRes.rows.length === 0) {
            console.error('❌ No hay empleado master');
            process.exit(1);
        }
        const masterId = mRes.rows[0].id;

        // 1) Soft-delete de las activas actuales
        const delRes = await sb.query(
            `UPDATE ar_invoices SET is_active = false, updated_by = $1, updated_at = NOW()
             WHERE client_id = $2 AND is_active = true`,
            [masterId, ISICSA_ID]
        );
        console.log(`  Desactivadas: ${delRes.rowCount} partidas activas de ISICSA`);

        // 2) Re-insertar las del respaldo con UPSERT (preserva IDs)
        let restored = 0;
        for (const inv of backup.invoices) {
            await sb.query(
                `INSERT INTO ar_invoices
                    (id, client_id, concept, gross_amount, vat_amount, net_amount,
                     invoice_date, source_type, source_id, invoice_number,
                     work_date, due_date, paid_amount, balance, status, notes,
                     is_active, created_at, updated_at, created_by, updated_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19,$19)
                 ON CONFLICT (id) DO UPDATE SET
                    client_id = EXCLUDED.client_id,
                    concept = EXCLUDED.concept,
                    gross_amount = EXCLUDED.gross_amount,
                    vat_amount = EXCLUDED.vat_amount,
                    net_amount = EXCLUDED.net_amount,
                    invoice_date = EXCLUDED.invoice_date,
                    source_type = EXCLUDED.source_type,
                    source_id = EXCLUDED.source_id,
                    invoice_number = EXCLUDED.invoice_number,
                    work_date = EXCLUDED.work_date,
                    due_date = EXCLUDED.due_date,
                    paid_amount = EXCLUDED.paid_amount,
                    balance = EXCLUDED.balance,
                    status = EXCLUDED.status,
                    notes = EXCLUDED.notes,
                    is_active = true,
                    updated_by = EXCLUDED.updated_by`,
                [
                    inv.id, inv.client_id, inv.concept, inv.gross_amount,
                    inv.vat_amount, inv.net_amount, inv.invoice_date,
                    inv.source_type, inv.source_id, inv.invoice_number,
                    inv.work_date, inv.due_date, inv.paid_amount ?? 0,
                    inv.balance, inv.status, inv.notes, true,
                    inv.created_at, masterId,
                ]
            );
            restored++;
        }
        console.log(`  Restauradas: ${restored} partidas`);
        console.log('');
        console.log('✅ Restauración completa.');

    } catch (e: any) {
        console.error('💥 Error:', e.message);
        process.exit(2);
    } finally {
        await sb.end();
    }
})();
