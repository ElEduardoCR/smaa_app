/**
 * Carga una tarifa de ISR o de subsidio al empleo desde un CSV.
 *
 * Uso:
 *   DB_URL=postgresql://... npx tsx scripts/import-tax-table.ts \
 *       <isr|subsidio> <periodicidad> <vigente-desde> <archivo.csv> [opciones]
 *
 * Ejemplo:
 *   DB_URL=... npx tsx scripts/import-tax-table.ts isr mensual 2026-01-01 isr-2026.csv \
 *       --hasta 2026-12-31 --fuente "DOF 30-dic-2025, Anexo 8" --verificada
 *
 * Formato del CSV (con o sin encabezado):
 *   limite_inferior,limite_superior,cuota_fija,porcentaje[,subsidio]
 *
 *   · limite_superior vacío o "en adelante" = último renglón
 *   · porcentaje acepta 1.92 o 0.0192 (si es > 1 se interpreta como %)
 *   · la 5a columna sólo aplica para tipo = subsidio
 *   · se ignoran comas de miles y el signo $
 *
 * El script NO marca la tarifa como verificada salvo que se pase
 * --verificada: la app avisa en cada recibo mientras no lo esté.
 */
import { readFileSync } from 'fs';
import { Client } from 'pg';

const PERIODICITIES = ['diaria', 'semanal', 'decenal', 'quincenal', 'mensual', 'anual'];

function usage(msg?: string): never {
    if (msg) console.error(`❌ ${msg}\n`);
    console.error('Uso: DB_URL=... npx tsx scripts/import-tax-table.ts <isr|subsidio> <periodicidad> <YYYY-MM-DD> <archivo.csv> [--hasta YYYY-MM-DD] [--fuente "texto"] [--verificada]');
    console.error(`Periodicidades válidas: ${PERIODICITIES.join(', ')}`);
    process.exit(1);
}

function num(raw: string): number | null {
    const cleaned = (raw || '').trim().replace(/[$,\s]/g, '');
    if (!cleaned || /^(en\s*adelante|adelante|-+)$/i.test(cleaned)) return null;
    const n = Number(cleaned);
    if (Number.isNaN(n)) throw new Error(`No pude leer el número: "${raw}"`);
    return n;
}

async function main() {
    const DB_URL = process.env.DB_URL;
    if (!DB_URL) usage('Falta DB_URL.');

    const [kind, periodicity, from, file] = process.argv.slice(2);
    if (!kind || !periodicity || !from || !file) usage('Faltan argumentos.');
    if (kind !== 'isr' && kind !== 'subsidio') usage(`Tipo inválido: ${kind}`);
    if (!PERIODICITIES.includes(periodicity)) usage(`Periodicidad inválida: ${periodicity}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) usage(`Fecha inválida: ${from}`);

    const args = process.argv.slice(2);
    const flag = (name: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const to = flag('--hasta') ?? null;
    const source = flag('--fuente') ?? `Importada de ${file}`;
    const verified = args.includes('--verificada');

    // --- Parseo del CSV ---------------------------------------------------
    const rows = readFileSync(file, 'utf-8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

    const brackets: Array<{
        lower: number; upper: number | null; fee: number; rate: number; subsidy: number | null;
    }> = [];

    for (const [i, raw] of rows.entries()) {
        const cols = raw.split(/[;,\t]/);
        if (cols.length < 4) throw new Error(`Renglón ${i + 1}: se esperaban al menos 4 columnas, llegaron ${cols.length}`);
        // Encabezado
        if (i === 0 && Number.isNaN(Number(cols[0].replace(/[$,\s]/g, '')))) continue;

        const lower = num(cols[0]);
        if (lower === null) throw new Error(`Renglón ${i + 1}: el límite inferior no puede ir vacío`);
        const upper = num(cols[1]);
        const fee = num(cols[2]) ?? 0;
        let rate = num(cols[3]) ?? 0;
        if (rate > 1) rate = rate / 100;     // venía como 1.92 en vez de 0.0192
        const subsidy = kind === 'subsidio' ? num(cols[4] ?? '') : null;

        brackets.push({ lower, upper, fee, rate, subsidy });
    }

    if (brackets.length === 0) throw new Error('El CSV no tiene renglones.');
    brackets.sort((a, b) => a.lower - b.lower);

    // --- Validaciones -----------------------------------------------------
    const problems: string[] = [];
    brackets.forEach((b, i) => {
        const next = brackets[i + 1];
        if (b.upper !== null && b.upper < b.lower) {
            problems.push(`Renglón ${i + 1}: el límite superior (${b.upper}) es menor que el inferior (${b.lower}).`);
        }
        if (next && b.upper !== null && next.lower <= b.upper) {
            problems.push(`Renglones ${i + 1}-${i + 2}: se traslapan (${b.upper} ≥ ${next.lower}).`);
        }
        if (next && b.upper === null) {
            problems.push(`Renglón ${i + 1}: sólo el último renglón puede quedar abierto.`);
        }
    });
    if (brackets[brackets.length - 1].upper !== null) {
        problems.push('El último renglón debería quedar abierto ("en adelante" / límite superior vacío).');
    }
    if (problems.length > 0) {
        console.error('❌ La tarifa no pasó la validación:');
        problems.forEach((p) => console.error(`   · ${p}`));
        process.exit(1);
    }

    // --- Carga ------------------------------------------------------------
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
        await client.query('BEGIN');

        // Cierra la vigencia de la tarifa anterior del mismo tipo/periodicidad
        const prevDay = new Date(from + 'T00:00:00');
        prevDay.setDate(prevDay.getDate() - 1);
        const closeAt = prevDay.toISOString().slice(0, 10);
        const closed = await client.query(
            `UPDATE public.tax_tables
                SET effective_to = $1
              WHERE kind = $2 AND periodicity = $3
                AND effective_from < $4
                AND (effective_to IS NULL OR effective_to >= $4)`,
            [closeAt, kind, periodicity, from],
        );

        const { rows: [table] } = await client.query(
            `INSERT INTO public.tax_tables (kind, periodicity, effective_from, effective_to, source, verified, verified_at)
             VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6 THEN NOW() ELSE NULL END)
             ON CONFLICT (kind, periodicity, effective_from)
             DO UPDATE SET effective_to = EXCLUDED.effective_to,
                           source = EXCLUDED.source,
                           verified = EXCLUDED.verified,
                           verified_at = EXCLUDED.verified_at
             RETURNING id`,
            [kind, periodicity, from, to, source, verified],
        );

        await client.query('DELETE FROM public.tax_table_brackets WHERE table_id = $1', [table.id]);
        for (const [i, b] of brackets.entries()) {
            await client.query(
                `INSERT INTO public.tax_table_brackets
                    (table_id, lower_limit, upper_limit, fixed_fee, rate, subsidy_amount, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [table.id, b.lower, b.upper, b.fee, b.rate, b.subsidy, i + 1],
            );
        }

        await client.query('COMMIT');

        console.log(`\n✓ Tarifa ${kind} ${periodicity} cargada — ${brackets.length} renglones`);
        console.log(`  Vigencia: ${from} → ${to ?? 'sin fecha de término'}`);
        console.log(`  Fuente:   ${source}`);
        if (closed.rowCount) console.log(`  Se cerró la vigencia de ${closed.rowCount} tarifa(s) anterior(es) al ${closeAt}`);
        if (!verified) {
            console.log('\n⚠️  Quedó marcada como SIN VERIFICAR. La nómina se puede calcular, pero');
            console.log('   cada recibo llevará el aviso hasta que alguien la coteje contra el DOF');
            console.log('   y la vuelva a cargar con --verificada.');
        }
        console.log();
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        await client.end();
    }
}

main().catch((e) => {
    console.error('💥', e instanceof Error ? e.message : e);
    process.exit(2);
});
