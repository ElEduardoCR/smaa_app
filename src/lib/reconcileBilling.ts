import 'server-only';
import { getServerSupabase } from './emailSync';

// ============================================================
// Motor de reconciliación: cotizaciones aprobadas ↔ facturas emitidas
// ------------------------------------------------------------
// Para cada cotización APROBADA del año objetivo, busca facturas
// emitidas del MISMO cliente (por RFC y, si no, por nombre) y le pide
// a Claude que empareje, a nivel PARTIDA, qué renglón de la cotización
// ya fue facturado en qué CFDI. Cada match se guarda como 'pending'
// para revisión en la bandeja.
// ============================================================

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

export const TARGET_YEAR = 2026;

type LineItem = {
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

type QuotationItemRow = {
    id: string;
    quotation_id: string;
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    line_total: number | null;
};

type QuotationRow = {
    id: string;
    quotation_number: string;
    client_id: number;
    status: string;
    total: number | null;
    created_at: string;
    client?: { business_name?: string | null; rfc?: string | null } | { business_name?: string | null; rfc?: string | null }[] | null;
};

type InvoiceRow = {
    id: string;
    uuid: string | null;
    folio: string | null;
    serie: string | null;
    receptor_rfc: string | null;
    receptor_nombre: string | null;
    total: number | null;
    invoice_date: string | null;
    line_items: LineItem[] | null;
};

export type ReconcileSummary = {
    year: number;
    quotationsScanned: number;
    quotationsWithCandidates: number;
    claudeCalls: number;
    newMatches: number;
    errors: string[];
};

const normRfc = (s?: string | null) => (s || '').toUpperCase().replace(/[\s-]/g, '').trim();

const normName = (s?: string | null) =>
    (s || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')  // quita acentos (marcas combinantes)
        .replace(/\b(S\.?A\.?\s*DE\s*C\.?V\.?|S\.?\s*DE\s*R\.?L\.?|SAPI|SC|AC)\b/g, '') // sufijos societarios
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

function namesMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    // Solapamiento fuerte de tokens (>=2 palabras significativas en común)
    const ta = new Set(a.split(' ').filter(w => w.length >= 3));
    const tb = new Set(b.split(' ').filter(w => w.length >= 3));
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    return shared >= 2;
}

function asClient(c: QuotationRow['client']): { business_name?: string | null; rfc?: string | null } {
    if (!c) return {};
    return Array.isArray(c) ? (c[0] || {}) : c;
}

const yearStart = `${TARGET_YEAR}-01-01T00:00:00.000Z`;
const yearEnd = `${TARGET_YEAR + 1}-01-01T00:00:00.000Z`;

type ClaudeMatch = {
    quotation_item_id: string;
    issued_invoice_id: string;
    invoice_concept?: string;
    matched_amount?: number;
    confidence?: number;
    reason?: string;
};

async function matchWithClaude(
    apiKey: string,
    quotation: { number: string; client: string; total: number },
    items: QuotationItemRow[],
    invoices: InvoiceRow[],
): Promise<ClaudeMatch[]> {
    const system = `Eres un asistente de facturación de una empresa mexicana. Recibes UNA cotización aprobada (con sus partidas) y una lista de facturas (CFDI) EMITIDAS al mismo cliente. Tu trabajo es determinar, a nivel de PARTIDA, qué renglón de la cotización ya fue facturado y en qué factura.

Reglas:
- Empareja por significado de la descripción (pueden variar las palabras) y por montos coherentes (cantidad × precio o importe del renglón).
- Una partida de la cotización puede facturarse parcialmente o en una factura distinta. Empareja una partida con A LO MÁS una factura.
- NO inventes emparejamientos. Si no hay correspondencia clara, no la incluyas.
- "matched_amount" = monto de esa partida que aparece facturado en ese CFDI (en MXN).
- "confidence" entre 0 y 1. Incluye solo emparejamientos con confidence >= 0.5.
- Usa EXACTAMENTE los id que te doy (quotation_item_id e issued_invoice_id).

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{ "matches": [ { "quotation_item_id": "...", "issued_invoice_id": "...", "invoice_concept": "...", "matched_amount": number, "confidence": number, "reason": "..." } ] }`;

    const payload = {
        cotizacion: {
            folio: quotation.number,
            cliente: quotation.client,
            total: quotation.total,
            partidas: items.map(it => ({
                quotation_item_id: it.id,
                descripcion: it.description || '',
                cantidad: Number(it.quantity) || 0,
                precio_unitario: Number(it.unit_price) || 0,
                importe: Number(it.line_total) || 0,
            })),
        },
        facturas: invoices.map(inv => ({
            issued_invoice_id: inv.id,
            folio: [inv.serie, inv.folio].filter(Boolean).join('-') || inv.uuid || '',
            fecha: inv.invoice_date,
            total: Number(inv.total) || 0,
            conceptos: (inv.line_items || []).slice(0, 60).map(c => ({
                descripcion: c.description || '',
                cantidad: Number(c.quantity) || 0,
                precio_unitario: Number(c.unit_price) || 0,
                importe: Number(c.line_total) || 0,
            })),
        })),
    };

    const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 2048,
            system,
            messages: [{ role: 'user', content: JSON.stringify(payload) }],
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Claude falló (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return Array.isArray(parsed.matches) ? (parsed.matches as ClaudeMatch[]) : [];
    } catch {
        return [];
    }
}

export async function reconcileBilling(): Promise<ReconcileSummary> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no está definida');

    const supabase = getServerSupabase();
    const summary: ReconcileSummary = {
        year: TARGET_YEAR,
        quotationsScanned: 0,
        quotationsWithCandidates: 0,
        claudeCalls: 0,
        newMatches: 0,
        errors: [],
    };

    // 1) Cotizaciones aprobadas del año objetivo + cliente
    const { data: quotes, error: qErr } = await supabase
        .from('quotations')
        .select('id, quotation_number, client_id, status, total, created_at, client:clients(business_name, rfc)')
        .eq('status', 'Approved')
        .gte('created_at', yearStart)
        .lt('created_at', yearEnd);
    if (qErr) throw new Error(`No se pudieron leer cotizaciones: ${qErr.message}`);

    const quotations = (quotes as QuotationRow[]) || [];
    summary.quotationsScanned = quotations.length;
    if (quotations.length === 0) return summary;

    // 2) Partidas de esas cotizaciones
    const quoteIds = quotations.map(q => q.id);
    const { data: itemsData, error: iErr } = await supabase
        .from('quotation_items')
        .select('id, quotation_id, description, quantity, unit_price, line_total')
        .in('quotation_id', quoteIds);
    if (iErr) throw new Error(`No se pudieron leer partidas: ${iErr.message}`);
    const itemsByQuote = new Map<string, QuotationItemRow[]>();
    for (const it of (itemsData as QuotationItemRow[]) || []) {
        const arr = itemsByQuote.get(it.quotation_id) || [];
        arr.push(it);
        itemsByQuote.set(it.quotation_id, arr);
    }

    // 3) Facturas emitidas del año objetivo
    const { data: invData, error: invErr } = await supabase
        .from('issued_invoices')
        .select('id, uuid, folio, serie, receptor_rfc, receptor_nombre, total, invoice_date, line_items')
        .gte('invoice_date', yearStart)
        .lt('invoice_date', yearEnd)
        .limit(10000);
    if (invErr) throw new Error(`No se pudieron leer facturas emitidas: ${invErr.message}`);
    const invoices = (invData as InvoiceRow[]) || [];

    // 4) Matches existentes (para no duplicar ni re-proponer rechazados)
    const existingPairs = new Set<string>();          // `${item_id}::${invoice_id}`
    const confirmedItems = new Set<string>();         // partidas ya facturadas (confirmadas)
    const { data: existing } = await supabase
        .from('quotation_billing_matches')
        .select('quotation_item_id, issued_invoice_id, status');
    for (const m of (existing as { quotation_item_id: string | null; issued_invoice_id: string | null; status: string }[]) || []) {
        if (m.quotation_item_id && m.issued_invoice_id) {
            existingPairs.add(`${m.quotation_item_id}::${m.issued_invoice_id}`);
        }
        if (m.status === 'confirmed' && m.quotation_item_id) confirmedItems.add(m.quotation_item_id);
    }

    const toInsert: any[] = [];

    // 5) Por cotización: candidatos + IA
    for (const q of quotations) {
        const client = asClient(q.client);
        const qRfc = normRfc(client.rfc);
        const qName = normName(client.business_name);

        const items = (itemsByQuote.get(q.id) || []).filter(it => !confirmedItems.has(it.id));
        if (items.length === 0) continue;

        // Candidatos: mismo cliente por RFC; si no hay RFC, por nombre
        let candidates = invoices.filter(inv => qRfc && normRfc(inv.receptor_rfc) === qRfc);
        if (candidates.length === 0 && qName) {
            candidates = invoices.filter(inv => namesMatch(qName, normName(inv.receptor_nombre)));
        }
        // Acota candidatos a aquellos que aún pueden aportar pares nuevos
        candidates = candidates
            .filter(inv => items.some(it => !existingPairs.has(`${it.id}::${inv.id}`)))
            .slice(0, 30);
        if (candidates.length === 0) continue;

        summary.quotationsWithCandidates++;

        try {
            const matches = await matchWithClaude(
                apiKey,
                { number: q.quotation_number, client: client.business_name || client.rfc || '—', total: Number(q.total) || 0 },
                items,
                candidates,
            );
            summary.claudeCalls++;

            const itemIds = new Set(items.map(it => it.id));
            const invIds = new Set(candidates.map(inv => inv.id));
            const itemById = new Map(items.map(it => [it.id, it]));
            const invById = new Map(candidates.map(inv => [inv.id, inv]));

            for (const m of matches) {
                if (!m.quotation_item_id || !m.issued_invoice_id) continue;
                if (!itemIds.has(m.quotation_item_id) || !invIds.has(m.issued_invoice_id)) continue;
                const conf = typeof m.confidence === 'number' ? m.confidence : 0;
                if (conf < 0.5) continue;
                const pairKey = `${m.quotation_item_id}::${m.issued_invoice_id}`;
                if (existingPairs.has(pairKey)) continue;
                existingPairs.add(pairKey);

                const it = itemById.get(m.quotation_item_id)!;
                const inv = invById.get(m.issued_invoice_id)!;
                toInsert.push({
                    quotation_id: q.id,
                    quotation_item_id: m.quotation_item_id,
                    issued_invoice_id: m.issued_invoice_id,
                    quotation_number: q.quotation_number,
                    client_name: client.business_name || client.rfc || null,
                    item_description: it.description || null,
                    invoice_uuid: inv.uuid,
                    invoice_folio: [inv.serie, inv.folio].filter(Boolean).join('-') || null,
                    invoice_concept: m.invoice_concept || null,
                    matched_amount: typeof m.matched_amount === 'number' ? m.matched_amount : (Number(it.line_total) || null),
                    confidence: conf,
                    ai_reason: m.reason || null,
                    status: 'pending',
                });
            }
        } catch (e: any) {
            summary.errors.push(`${q.quotation_number}: ${e.message}`);
        }
    }

    // 6) Inserta en lotes
    const BATCH = 100;
    for (let i = 0; i < toInsert.length; i += BATCH) {
        const slice = toInsert.slice(i, i + BATCH);
        const { error } = await supabase.from('quotation_billing_matches').insert(slice);
        if (error) summary.errors.push(`insert: ${error.message}`);
        else summary.newMatches += slice.length;
    }

    return summary;
}
