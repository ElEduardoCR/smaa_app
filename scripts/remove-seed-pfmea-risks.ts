/**
 * ===========================================================================
 * remove-seed-pfmea-risks.ts
 * ===========================================================================
 *
 * Respaldo + eliminación de los 5 riesgos de ejemplo que se seedearon
 * con la migración 20260811093003_pfmea_seed.sql.
 *
 * Se identifican por `created_by IS NULL` (los seedeados no tenían autor).
 * Los riesgos que tú crees con la UI van a tener created_by = tu employee_id,
 * por lo que NO se tocan.
 *
 * Las definiciones de las escalas (pfmea_scales) NO se eliminan: las 15
 * definiciones de los 5 niveles de severity/occurrence/detection son
 * parte de la configuración estándar, no "ejemplos".
 *
 * Uso:
 *   DB_URL=postgresql://... npx tsx scripts/remove-seed-pfmea-risks.ts
 * ===========================================================================
 */

import { Client } from 'pg';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
    console.error('❌ Falta DB_URL');
    process.exit(1);
}

const sb = new Client({ connectionString: DB_URL });

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = 'scripts/backups';
const BACKUP_FILE = `${BACKUP_DIR}/pfmea-seeded-risks-${ts}.json`;

(async () => {
    try {
        await sb.connect();
        console.log('✓ Conectado a la DB\n');

        if (!existsSync(BACKUP_DIR)) {
            mkdirSync(BACKUP_DIR, { recursive: true });
        }

        // 1) Conteo previo
        const before = await sb.query(`
            SELECT
                count(*) FILTER (WHERE is_active = true) AS active,
                count(*) FILTER (WHERE is_active = true AND created_by IS NULL) AS seed_active,
                count(*) FILTER (WHERE is_active = true AND created_by IS NOT NULL) AS user_active,
                count(*) FILTER (WHERE is_active = false) AS inactive
            FROM pfmea_risks
        `);
        const b = before.rows[0];
        console.log('═══ ANTES ═══');
        console.log(`  Activos totales:           ${b.active}`);
        console.log(`  Activos seedeados (NULL):  ${b.seed_active}   ← se eliminan`);
        console.log(`  Activos del usuario:       ${b.user_active}   (no se tocan)`);
        console.log(`  Ya inactivos:              ${b.inactive}`);
        console.log('');

        if (Number(b.seed_active) === 0) {
            console.log('No hay riesgos seedeados. Nada que eliminar.\n');
            return;
        }

        // 2) Respaldo
        console.log('═══ RESPALDO ═══');
        const backup = await sb.query(`
            SELECT * FROM pfmea_risks
            WHERE created_by IS NULL
            ORDER BY rpn DESC
        `);
        const payload = {
            backup_date: new Date().toISOString(),
            backup_reason: 'Eliminación de riesgos seedeados (seed inicial)',
            restored_by: 'Si necesitas restaurarlos, corre el INSERT manualmente desde este JSON.',
            risks: backup.rows,
        };
        writeFileSync(BACKUP_FILE, JSON.stringify(payload, null, 2));
        console.log(`  Archivo: ${BACKUP_FILE}`);
        console.log(`  Riesgos: ${backup.rows.length}`);
        console.log('');

        // 3) Listar lo que se va a eliminar
        console.log('═══ SE VA A ELIMINAR ═══');
        for (const r of backup.rows) {
            console.log(`  RPN=${String(r.rpn).padStart(3)} | ${r.failure_mode.slice(0, 60)}`);
        }
        console.log('');

        // 4) DELETE (hard delete, ya hay respaldo)
        console.log('═══ ELIMINANDO ═══');
        const del = await sb.query(`
            DELETE FROM pfmea_risks
            WHERE created_by IS NULL
            RETURNING id, process
        `);
        console.log(`  ✓ Eliminados: ${del.rowCount} riesgos`);
        console.log('');

        // 5) Verificación
        console.log('═══ DESPUÉS ═══');
        const after = await sb.query(`
            SELECT
                count(*) FILTER (WHERE is_active = true) AS active,
                count(*) FILTER (WHERE is_active = true AND created_by IS NULL) AS seed_active,
                count(*) FILTER (WHERE is_active = true AND created_by IS NOT NULL) AS user_active
            FROM pfmea_risks
        `);
        const a = after.rows[0];
        console.log(`  Activos totales:           ${a.active}`);
        console.log(`  Activos seedeados (NULL):  ${a.seed_active}   ← debe ser 0`);
        console.log(`  Activos del usuario:       ${a.user_active}`);
        console.log('');

        if (Number(a.seed_active) === 0) {
            console.log('✅ Listo. Ya puedes meter tus propios riesgos.');
        } else {
            console.error(`⚠️  Quedan ${a.seed_active} riesgos seedeados. Algo falló.`);
            process.exit(3);
        }
        console.log(`\\nRespaldo en: ${BACKUP_FILE}`);
        console.log('(Si los quieres restaurar, corre el INSERT desde ese JSON o dime y lo hago.)');

    } catch (e: any) {
        console.error('\\n💥 Error:', e.message);
        process.exit(2);
    } finally {
        await sb.end();
    }
})();
