/**
 * ===========================================================================
 * update-isicsa-ar-2026-08-08.ts
 * ===========================================================================
 *
 * Respalda las ar_invoices de ISICSA y aplica los cambios del Excel
 * "Deuda y Ventas ISICSA 2026.xlsx" (fecha de hoy).
 *
 * Acciones:
 *   1) Respaldo completo de ar_invoices del cliente ISICSA a un JSON
 *      timestamped en scripts/backups/.
 *   2) UPDATE de 5 partidas existentes (cambia nombre y/o monto).
 *   3) INSERT de 21 partidas nuevas (idempotente: si ya existe la combinación
 *      client_id + concept + gross_amount, la salta).
 *
 * Uso:
 *   DB_URL=postgresql://... npx tsx scripts/update-isicsa-ar-2026-08-08.ts
 *
 * Restaurar (si algo sale mal):
 *   DB_URL=postgresql://... npx tsx scripts/restore-isicsa-ar.ts <archivo-backup>
 * ===========================================================================
 */

import { Client } from 'pg';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
    console.error('❌ Falta DB_URL');
    console.error('  DB_URL="postgresql://..." npx tsx scripts/update-isicsa-ar-2026-08-08.ts');
    process.exit(1);
}

const sb = new Client({ connectionString: DB_URL });

const ISICSA_ID = 6;
const TODAY = '2026-08-08';
const SOURCE = 'manual';
const VAT_RATE = 0.16;

const computeVat = (gross: number) => {
    const vat = Math.round(gross * VAT_RATE * 100) / 100;
    const net = Math.round((gross + vat) * 100) / 100;
    return { vat, net };
};

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_FILE = `scripts/backups/isicsa-ar-backup-${ts}.json`;

// 5 UPDATEs: cada uno busca por (client_id, OLD_concept, is_active=true)
// y cambia el concept y/o gross_amount (recalculando vat y net).
interface UpdateSpec {
    from: string;                  // concept actual en la DB
    to: string;                    // concept nuevo
    gross?: number;                // si cambia, nuevo gross; si no, conserva
    note: string;                  // nota humana
}
const UPDATES: UpdateSpec[] = [
    { from: 'Modificacion de control tronzadora', to: 'Modificacion de tronzadora',                       note: 'mismo monto, nombre más corto' },
    { from: 'Gabinete Chanez London',             to: 'Rack de Puebas London Chanez',                   note: 'mismo monto, nombre actualizado' },
    { from: 'Rack Chatarra',                      to: 'Rack Chatarra andres',          gross: 44919.22, note: 'estaba en $0, ahora con monto real' },
    { from: 'Cambio Botoeneras',                  to: 'Reubicacion de Botoneras ISAC 2 crimpadoras', gross: 7000,    note: 'estaba en $0, ahora con monto real' },
    { from: 'Mantenimiento carros Mario',         to: 'Mantenimiento carros MIR',                      note: 'mismo monto, nombre actualizado' },
];

// 21 INSERTs nuevos. Idempotente: si ya existe (client_id, concept, gross) la salta.
interface NewSpec { concept: string; gross: number; }
const INSERTS: NewSpec[] = [
    // Unificación de las 2 partidas de cuerdas
    { concept: 'Suministro e instalación de cuerdas para caballetes', gross: 88800.00 },
    // Segundo factbird (mismo precio que el primero)
    { concept: 'Segundo factbird',                                    gross: 10626.25 },
    // 15 partidas seguras nuevas (del Excel, sin match en el seed)
    { concept: 'Reqcondicionameinto de Prensa Termica',                gross:  37922.00 },
    { concept: 'Contados de Prensa Luis Martinez',                    gross:  31584.00 },
    { concept: 'Durometro Reina',                                     gross:  60668.00 },
    { concept: 'Suministro e instalacion de 2 baterias para emplayadora', gross: 18965.00 },
    { concept: 'Racks para Chatarra Reforzados',                      gross:  62763.00 },
    { concept: 'Rack Elevador para Conveyors Natalia',                gross:  71897.50 },
    { concept: 'caro para canales Cartige Natalia',                   gross:  40478.20 },
    { concept: 'Carros y Racks Jaqueline',                            gross:  62396.50 },
    { concept: 'Puete union telescopico 10 sets',                     gross:  45700.00 },
    { concept: 'Cripadora Jaquelin',                                  gross:  44264.88 },
    { concept: 'Control Emplayadora',                                 gross:  60095.25 },
    { concept: 'Puertas Area de Soldadura Cambio a Policarbonato',    gross: 183644.88 },
    { concept: 'Rieles para Descarga de MIR Jenifr',                  gross: 151206.60 },
    { concept: 'Cabina de Secado Metal Finish',                       gross: 202700.00 },
    { concept: 'Estacion de Pruebas con ele mentos de Seguridad',     gross:  14250.00 },
    // 4 partidas sin monto (placeholders en $0)
    { concept: '2 Mamparas Andres',                                   gross:      0.00 },
    { concept: 'Tornito Tania',                                       gross:      0.00 },
    { concept: 'Sierra Tania',                                        gross:      0.00 },
    { concept: 'Set de Dados para Insertadora de Ligas Tania  (3 pz por Set)', gross: 0.00 },
];

(async () => {
    try {
        await sb.connect();
        console.log('✓ Conectado a la DB');
        console.log('');

        // ===== FASE 1: RESPALDO =====
        console.log('═══ FASE 1: RESPALDO ═══');

        if (!existsSync('scripts/backups')) {
            mkdirSync('scripts/backups', { recursive: true });
        }

        const cRes = await sb.query(`SELECT id, business_name, rfc FROM clients WHERE id = $1`, [ISICSA_ID]);
        if (cRes.rows.length === 0) {
            console.error(`❌ Cliente ISICSA (id=${ISICSA_ID}) no existe.`);
            process.exit(1);
        }
        const client = cRes.rows[0];
        console.log(`  Cliente: ${client.business_name} (RFC: ${client.rfc})`);

        const mRes = await sb.query(`SELECT id, username FROM employees WHERE role = 'master' ORDER BY created_at LIMIT 1`);
        if (mRes.rows.length === 0) {
            console.error('❌ No hay empleado master. Crea uno primero.');
            process.exit(1);
        }
        const master = mRes.rows[0];
        console.log(`  Master:  ${master.username} (${master.id})`);

        const backupRes = await sb.query(
            `SELECT * FROM ar_invoices WHERE client_id = $1 ORDER BY id`,
            [ISICSA_ID]
        );
        const backup = {
            backup_date: new Date().toISOString(),
            client_id: ISICSA_ID,
            client_name: client.business_name,
            client_rfc: client.rfc,
            master_user: master.username,
            total_records: backupRes.rows.length,
            invoices: backupRes.rows,
        };
        writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
        console.log(`  Respaldo: ${BACKUP_FILE}`);
        console.log(`  Registros: ${backupRes.rows.length}`);
        console.log('');

        // ===== FASE 2: UPDATES =====
        console.log('═══ FASE 2: UPDATES (5 partidas) ═══');

        let updatedRows = 0;
        for (const u of UPDATES) {
            let res;
            if (u.gross !== undefined) {
                const { vat, net } = computeVat(u.gross);
                res = await sb.query(
                    `UPDATE ar_invoices
                     SET concept = $1, gross_amount = $2, vat_amount = $3, net_amount = $4,
                         updated_by = $5, updated_at = NOW()
                     WHERE client_id = $6 AND concept = $7 AND is_active = true
                     RETURNING id, concept, gross_amount`,
                    [u.to, u.gross, vat, net, master.id, ISICSA_ID, u.from]
                );
            } else {
                res = await sb.query(
                    `UPDATE ar_invoices
                     SET concept = $1, updated_by = $2, updated_at = NOW()
                     WHERE client_id = $3 AND concept = $4 AND is_active = true
                     RETURNING id, concept`,
                    [u.to, master.id, ISICSA_ID, u.from]
                );
            }
            if (res.rows.length === 0) {
                console.log(`  ⚠️  No encontrada: "${u.from}" — no se actualizó`);
            } else {
                for (const r of res.rows) {
                    const montoTxt = u.gross !== undefined ? ` ($${u.gross.toFixed(2)})` : '';
                    console.log(`  ✓ id=${r.id}  "${u.from}"  →  "${r.concept}"${montoTxt}`);
                    console.log(`      ${u.note}`);
                    updatedRows++;
                }
            }
        }
        console.log(`  Total actualizadas: ${updatedRows}`);
        console.log('');

        // ===== FASE 3: INSERTS =====
        console.log('═══ FASE 3: INSERTS (21 partidas nuevas) ═══');

        let inserted = 0, skipped = 0, totalGross = 0, totalNet = 0, totalVat = 0;
        const blanks: string[] = [];

        for (const p of INSERTS) {
            const { vat, net } = computeVat(p.gross);

            const existing = await sb.query(
                `SELECT id FROM ar_invoices WHERE client_id = $1 AND concept = $2 AND gross_amount = $3 AND is_active = true`,
                [ISICSA_ID, p.concept, p.gross]
            );

            if (existing.rows.length > 0) {
                console.log(`  ⏭️  Ya existe: "${p.concept}" ($${p.gross.toFixed(2)})`);
                skipped++;
                if (p.gross === 0) blanks.push(p.concept);
                continue;
            }

            await sb.query(
                `INSERT INTO ar_invoices
                    (client_id, concept, gross_amount, vat_amount, net_amount,
                     invoice_date, source_type, status, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8)`,
                [ISICSA_ID, p.concept, p.gross, vat, net, TODAY, SOURCE, master.id]
            );

            console.log(`  ✓ Insertada: "${p.concept}" ($${p.gross.toFixed(2)})`);
            inserted++;
            totalGross += p.gross;
            totalVat += vat;
            totalNet += net;
            if (p.gross === 0) blanks.push(p.concept);
        }

        console.log('');
        console.log('  Resumen de inserts:');
        console.log(`    Insertadas:          ${inserted}`);
        console.log(`    Ya existentes:       ${skipped}`);
        console.log(`    TOTALES (nuevas):`);
        console.log(`      Bruto:  $ ${totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`      IVA 16%: $ ${totalVat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`      Neto:   $ ${totalNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

        if (blanks.length > 0) {
            console.log('');
            console.log('  ⚠️  Partidas en $0 (placeholder, editar después desde la UI):');
            blanks.forEach(b => console.log(`     - ${b}`));
        }

        // ===== FASE 4: VERIFICACIÓN =====
        console.log('');
        console.log('═══ FASE 4: VERIFICACIÓN ═══');
        const afterRes = await sb.query(
            `SELECT count(*) as total, count(*) FILTER (WHERE is_active=true) as active,
                    coalesce(sum(gross_amount) FILTER (WHERE is_active=true), 0) as sum_gross
             FROM ar_invoices WHERE client_id = $1`,
            [ISICSA_ID]
        );
        const a = afterRes.rows[0];
        console.log(`  ISICSA después: ${a.total} total / ${a.active} activas / $${Number(a.sum_gross).toFixed(2)} bruto`);

        // Verificar que las 5 updates se aplicaron (buscar por el nombre nuevo)
        console.log('  Verificando updates:');
        for (const u of UPDATES) {
            const chk = await sb.query(
                `SELECT id, gross_amount FROM ar_invoices WHERE client_id = $1 AND concept = $2 AND is_active = true`,
                [ISICSA_ID, u.to]
            );
            if (chk.rows.length === 1) {
                console.log(`    ✓ "${u.to}"`);
            } else if (chk.rows.length === 0) {
                console.log(`    ✗ NO EXISTE "${u.to}" — update falló`);
            } else {
                console.log(`    ⚠️  ${chk.rows.length} copias de "${u.to}"`);
            }
        }

        // Verificar que las 2 SKIPs NO se duplicaron
        console.log('  Verificando que no se duplicaron:');
        const skp1 = await sb.query(
            `SELECT count(*) as n FROM ar_invoices WHERE client_id = $1 AND concept = $2 AND is_active = true`,
            [ISICSA_ID, 'Modificacion de tronzadora']
        );
        const skp2 = await sb.query(
            `SELECT count(*) as n FROM ar_invoices WHERE client_id = $1 AND concept = $2 AND is_active = true`,
            [ISICSA_ID, 'Rack de Puebas London Chanez']
        );
        console.log(`    "Modificacion de tronzadora":        ${skp1.rows[0].n} (debe ser 1)`);
        console.log(`    "Rack de Puebas London Chanez":      ${skp2.rows[0].n} (debe ser 1)`);

        console.log('');
        console.log('✅ Listo.');
        console.log(`   Respaldo en: ${BACKUP_FILE}`);
        console.log(`   Si algo salió mal, restaurar con:`);
        console.log(`     DB_URL=... npx tsx scripts/restore-isicsa-ar.ts ${BACKUP_FILE}`);

    } catch (e: any) {
        console.error('');
        console.error('💥 Error durante la ejecución:', e.message);
        console.error(`   El respaldo está en: ${BACKUP_FILE}`);
        console.error('   La DB puede estar en un estado parcial. Restaura con:');
        console.error(`     DB_URL=... npx tsx scripts/restore-isicsa-ar.ts ${BACKUP_FILE}`);
        process.exit(2);
    } finally {
        await sb.end();
    }
})();
