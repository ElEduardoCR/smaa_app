/**
 * ===========================================================================
 * cleanup-draft-purchase-orders.ts
 * ===========================================================================
 *
 * Respaldo + soft-delete de TODAS las purchase_orders con status='Draft'.
 *
 * - Respaldo completo: guarda TODAS las POs (no solo drafts) más sus items
 *   y attachments a un JSON timestamped, por si necesitamos restaurar.
 * - Soft-delete: marca los drafts como is_active=false. Mantiene el registro
 *   para auditoría contable.
 *
 * Para revertir (si algo sale mal), usar scripts/restore-purchase-orders.ts
 * con el archivo de respaldo generado.
 *
 * Uso:
 *   DB_URL=postgresql://... npx tsx scripts/cleanup-draft-purchase-orders.ts
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
const DRAFT_STATUS = 'Draft';

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = 'scripts/backups';
const BACKUP_FILE = `${BACKUP_DIR}/purchase-orders-backup-${ts}.json`;

(async () => {
    try {
        await sb.connect();
        console.log('✓ Conectado a la DB\n');

        if (!existsSync(BACKUP_DIR)) {
            mkdirSync(BACKUP_DIR, { recursive: true });
        }

        // ===== FASE 1: CONTEO PREVIO =====
        console.log('═══ FASE 1: CONTEO PREVIO ═══');
        const beforeRes = await sb.query(`
            SELECT
                count(*) FILTER (WHERE is_active = true)  AS active_total,
                count(*) FILTER (WHERE is_active = true AND status = $1)  AS active_drafts,
                count(*) FILTER (WHERE is_active = true AND status <> $1) AS active_non_drafts,
                count(*) FILTER (WHERE is_active = false) AS inactive_total
            FROM purchase_orders
        `, [DRAFT_STATUS]);
        const b = beforeRes.rows[0];
        console.log(`  Activas totales:    ${b.active_total}`);
        console.log(`  Activas en Draft:   ${b.active_drafts}   ← serán soft-deleted`);
        console.log(`  Activas NO Draft:   ${b.active_non_drafts}   (no se tocan)`);
        console.log(`  Ya inactivas:       ${b.inactive_total}`);
        console.log('');

        if (Number(b.active_drafts) === 0) {
            console.log('No hay drafts activos. Nada que hacer. (Igual hago el respaldo por si acaso.)\n');
        }

        // ===== FASE 2: RESPALDO COMPLETO =====
        console.log('═══ FASE 2: RESPALDO COMPLETO ═══');
        const posRes = await sb.query(`
            SELECT * FROM purchase_orders ORDER BY created_at
        `);
        const itemsRes = await sb.query(`SELECT * FROM purchase_order_items`);

        // Detectar si existe la tabla de adjuntos (no todas las instalaciones la tienen)
        const attExists = await sb.query(`
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'purchase_order_attachments'
        `);
        let attRes: any = { rows: [] };
        if (attExists.rows.length > 0) {
            attRes = await sb.query(`SELECT * FROM purchase_order_attachments`);
        } else {
            console.log('  (purchase_order_attachments no existe, se omite del respaldo)');
        }

        // Mapas para que sea fácil restaurar
        const itemsByPo: Record<string, any[]> = {};
        for (const it of itemsRes.rows) {
            const k = it.purchase_order_id;
            (itemsByPo[k] ||= []).push(it);
        }
        const attsByPo: Record<string, any[]> = {};
        for (const a of attRes.rows) {
            const k = a.purchase_order_id;
            (attsByPo[k] ||= []).push(a);
        }

        const backup = {
            backup_date: new Date().toISOString(),
            backup_reason: 'Pre-cleanup de purchase_orders en status=Draft',
            totals_at_backup: {
                purchase_orders: posRes.rows.length,
                purchase_order_items: itemsRes.rows.length,
                purchase_order_attachments: attRes.rows.length,
                active_drafts_to_delete: Number(b.active_drafts),
            },
            purchase_orders: posRes.rows,
            purchase_order_items: itemsRes.rows,
            purchase_order_attachments: attRes.rows,
            purchase_order_items_indexed_by_po: itemsByPo,
            purchase_order_attachments_indexed_by_po: attsByPo,
        };
        writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
        const sizeKb = (Buffer.byteLength(JSON.stringify(backup)) / 1024).toFixed(1);
        console.log(`  Respaldo: ${BACKUP_FILE}`);
        console.log(`  Tamaño:   ${sizeKb} KB`);
        console.log(`  POs:      ${posRes.rows.length}`);
        console.log(`  Items:    ${itemsRes.rows.length}`);
        console.log(`  Adjuntos: ${attRes.rows.length}`);
        console.log('');

        // ===== FASE 3: SOFT-DELETE DE DRAFTS =====
        console.log('═══ FASE 3: SOFT-DELETE DE DRAFTS ═══');
        if (Number(b.active_drafts) === 0) {
            console.log('  No hay drafts activos que eliminar. Saltando.');
        } else {
            // Listar los drafts a eliminar (para mostrar)
            const draftsListRes = await sb.query(`
                SELECT id, po_number, supplier_id, total, created_at
                FROM purchase_orders
                WHERE status = $1 AND is_active = true
                ORDER BY created_at
            `, [DRAFT_STATUS]);
            console.log(`  Drafts a soft-deleted:`);
            for (const d of draftsListRes.rows) {
                const c = d.created_at?.toISOString?.()?.slice(0, 19) ?? '';
                console.log(`    - ${d.po_number} | $${Number(d.total).toFixed(2)} | ${c} | id=${d.id.slice(0,8)}…`);
            }
            console.log('');

            // Soft-delete (sin updated_by porque la columna no existe en esta DB)
            const delRes = await sb.query(`
                UPDATE purchase_orders
                SET is_active = false, updated_at = NOW()
                WHERE status = $1 AND is_active = true
                RETURNING id, po_number
            `, [DRAFT_STATUS]);
            console.log(`  ✓ Soft-deleted: ${delRes.rowCount} drafts`);
            console.log('');
        }

        // ===== FASE 4: VERIFICACIÓN =====
        console.log('═══ FASE 4: VERIFICACIÓN ═══');
        const afterRes = await sb.query(`
            SELECT
                count(*) FILTER (WHERE is_active = true)  AS active_total,
                count(*) FILTER (WHERE is_active = true AND status = $1)  AS active_drafts,
                count(*) FILTER (WHERE is_active = true AND status <> $1) AS active_non_drafts,
                count(*) FILTER (WHERE is_active = false) AS inactive_total,
                count(*) FILTER (WHERE is_active = false AND status = $1) AS inactive_drafts
            FROM purchase_orders
        `, [DRAFT_STATUS]);
        const a = afterRes.rows[0];
        console.log(`  Activas totales:    ${a.active_total}`);
        console.log(`  Activas en Draft:   ${a.active_drafts}   ← debe ser 0`);
        console.log(`  Activas NO Draft:   ${a.active_non_drafts}   (sin cambios)`);
        console.log(`  Inactivas totales:  ${a.inactive_total}`);
        console.log(`  Inactivas en Draft: ${a.inactive_drafts}   ← drafts soft-deleted`);
        console.log('');

        if (Number(a.active_drafts) === 0) {
            console.log('✅ LISTO. No quedan drafts activos.');
        } else {
            console.error(`⚠️  Quedan ${a.active_drafts} drafts activos. Algo falló.`);
            process.exit(3);
        }
        console.log('');
        console.log(`Respaldo en: ${BACKUP_FILE}`);
        console.log(`Si necesitas revertir, puedo escribir un script de restore. Dime.`);

    } catch (e: any) {
        console.error('');
        console.error('💥 Error:', e.message);
        console.error('   Nada se eliminó (o se eliminó parcialmente). Revisa el estado de la DB.');
        process.exit(2);
    } finally {
        await sb.end();
    }
})();
