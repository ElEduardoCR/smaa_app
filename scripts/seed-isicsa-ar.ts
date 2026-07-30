/**
 * ===========================================================================
 * seed-isicsa-ar.ts
 * ===========================================================================
 *
 * Seed one-time para cargar las 28 partidas de ISICSA al módulo de
 * Cuentas por Cobrar (AR). Los precios capturados son BRUTOS (sin IVA);
 * el sistema calcula automáticamente el IVA 16% y el neto.
 *
 * - La celda pintada de rojo (Cortes de Soleras) → $0
 * - Donde no hay dato en el Excel → $0 (queda editable desde la UI)
 * - Idempotente: si la partida ya existe (mismo concept + gross), la omite.
 *   Para re-seed completo, ejecuta primero la sección "RESET" abajo.
 *
 * Uso:
 *   DB_URL=postgresql://postgres:xxx@host:5432/postgres \
 *     npx tsx scripts/seed-isicsa-ar.ts
 * ===========================================================================
 */

import { Client } from 'pg';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
    console.error('❌ Falta DB_URL');
    process.exit(1);
}

const sb = new Client({ connectionString: DB_URL });

const VAT_RATE = 0.16;
const computeVat = (gross: number) => {
    const vat = Math.round(gross * VAT_RATE * 100) / 100;
    const net = Math.round((gross + vat) * 100) / 100;
    return { vat, net };
};

const ISICSA_ID = 6;
const INVOICE_DATE = '2026-07-29';
const SOURCE = 'manual';

// 28 partidas capturadas del Excel del cliente. gross_amount en pesos brutos.
const PARTIDAS: Array<{ concept: string; gross: number }> = [
    { concept: 'Coronas de 2 a 3" e Insertos YG',                        gross: 187226.11 },
    { concept: 'Machuelos, Avellanadores y Boquillas DAVID QUOT 320',     gross:  65283.00 },
    { concept: '3 Avellanadores faricados de 2 Filos de Carburo 1"',      gross:  14550.00 },
    { concept: '2 Avellanadores Faricados de 4 Filos de Carburo 1"',      gross:  10520.00 },
    { concept: 'Cortes de Soleras',                                       gross:      0.00 }, // celda roja del Excel
    { concept: 'Rack de Chanec',                                          gross:  67578.99 },
    { concept: 'Fixtura de Acero Inoxidable Urgente',                     gross:  10665.00 },
    { concept: 'Mantenimiento y reparacion de cilindro apilador electrico', gross: 22350.00 },
    { concept: 'Mantenimiento y Diagnostico de Tungger',                  gross:  15200.00 },
    { concept: '10 Boquillas Negras',                                     gross:  41530.00 },
    { concept: '4 Guardas de conveyor',                                   gross:   7200.00 },
    { concept: 'Control Sierra, instlacion de cortinas y PLC Isac',       gross:  77125.50 },
    { concept: 'Mantenimiento carros Mario',                              gross:  19940.00 },
    { concept: 'Brocas Isac 21 pz no.24',                                 gross:   1747.48 },
    { concept: 'Puertas sierra',                                          gross:  21022.32 },
    { concept: 'Mesa sorter',                                             gross: 247973.12 },
    { concept: 'Cambio Botoeneras',                                       gross:      0.00 }, // sin dato en Excel
    { concept: 'Escuadras',                                               gross:  19747.20 },
    { concept: 'Cabina',                                                  gross:  85591.60 },
    { concept: 'Rodillos',                                                gross:  11232.54 },
    { concept: 'Escuadras',                                               gross:   9325.00 },
    { concept: 'Gabinete Chanez London',                                  gross: 175245.00 },
    { concept: 'Gabinete Luis Sandoval Control Box',                      gross: 255918.20 },
    { concept: 'Factbird',                                                gross:  10626.25 },
    { concept: 'Plataforma para tarima',                                  gross:  13258.00 },
    { concept: '2 estaciones de pruebas conveyor',                        gross:  24375.00 },
    { concept: 'Modificacion de control tronzadora',                      gross:  72589.38 },
    { concept: 'Rack Chatarra',                                           gross:      0.00 }, // sin dato en Excel
];

(async () => {
    try {
        await sb.connect();
        console.log('🌱 Seed AR — Cliente ISICSA (id=' + ISICSA_ID + ')');
        console.log('   Fecha: ' + INVOICE_DATE);
        console.log('');

        // Confirmar que ISICSA existe
        const cRes = await sb.query(`SELECT id, business_name, rfc FROM clients WHERE id = $1`, [ISICSA_ID]);
        if (cRes.rows.length === 0) {
            console.error('❌ Cliente ISICSA (id=' + ISICSA_ID + ') no existe. Créalo primero en /clients.');
            process.exit(1);
        }
        console.log('   Cliente: ' + cRes.rows[0].business_name + ' (RFC: ' + cRes.rows[0].rfc + ')');
        console.log('');

        // Obtener master como created_by
        const mRes = await sb.query(`SELECT id, username FROM employees WHERE role = 'master' ORDER BY created_at LIMIT 1`);
        if (mRes.rows.length === 0) {
            console.error('❌ No hay empleado master. Crea uno primero.');
            process.exit(1);
        }
        const createdBy = mRes.rows[0].id;
        console.log('   Registrado por: ' + mRes.rows[0].username);
        console.log('');

        // Insertar (idempotente: si ya existe misma (client_id, concept, gross) la omitimos)
        let inserted = 0, skipped = 0, totalGross = 0, totalNet = 0, totalVat = 0;
        const blanks: string[] = [];

        for (let i = 0; i < PARTIDAS.length; i++) {
            const p = PARTIDAS[i];
            const { vat, net } = computeVat(p.gross);

            // Verificar si ya existe
            const existing = await sb.query(
                `SELECT id FROM ar_invoices WHERE client_id = $1 AND concept = $2 AND gross_amount = $3 AND is_active = true`,
                [ISICSA_ID, p.concept, p.gross]
            );

            if (existing.rows.length > 0) {
                skipped++;
                if (p.gross === 0) blanks.push(p.concept);
                continue;
            }

            await sb.query(
                `INSERT INTO ar_invoices
                    (client_id, concept, gross_amount, vat_amount, net_amount, invoice_date, source_type, status, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8)`,
                [ISICSA_ID, p.concept, p.gross, vat, net, INVOICE_DATE, SOURCE, createdBy]
            );

            inserted++;
            totalGross += p.gross;
            totalVat += vat;
            totalNet += net;
            if (p.gross === 0) blanks.push(p.concept);
        }

        console.log('📊 Resumen:');
        console.log('   Partidas insertadas:    ' + inserted);
        console.log('   Partidas ya existentes: ' + skipped);
        console.log('   TOTALES (suma de las nuevas):');
        console.log('     Bruto:  $ ' + totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        console.log('     IVA 16%: $ ' + totalVat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        console.log('     Neto:   $ ' + totalNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        console.log('');
        if (blanks.length > 0) {
            console.log('⚠️  Partidas con monto $0 (edítalas desde la UI):');
            blanks.forEach((b) => console.log('     - ' + b));
            console.log('');
        }
        console.log('✅ Listo. Ver en: /finance/receivable/' + ISICSA_ID);
    } catch (e: any) {
        console.error('💥 Error:', e.message);
        process.exit(2);
    } finally {
        await sb.end();
    }
})();
