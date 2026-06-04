import { NextRequest, NextResponse } from 'next/server';
import { reconcileBilling } from '@/lib/reconcileBilling';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min en Vercel

function authorized(req: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const header = req.headers.get('authorization') || '';
    if (header === `Bearer ${secret}`) return true;
    const url = new URL(req.url);
    if (url.searchParams.get('secret') === secret) return true;
    return false;
}

// Cron diario (6 AM CDMX). Detecta qué partidas de cotizaciones aprobadas
// ya fueron facturadas y las deja en la bandeja para revisión.
export async function GET(req: NextRequest) {
    if (!authorized(req)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    try {
        const summary = await reconcileBilling();
        return NextResponse.json({ ok: true, ...summary });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
