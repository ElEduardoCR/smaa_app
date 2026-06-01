import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase, runEmailSync } from '@/lib/emailSync';

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

// Rango del día anterior en zona CDMX (UTC-6, sin horario de verano desde 2022)
function getYesterdayBoundsCDMX(): { after: Date; before: Date } {
    const OFFSET_MIN = -6 * 60; // CDMX = UTC-6
    const now = new Date();
    // Mueve el "ahora" a la hora de pared CDMX representada como UTC
    const cdmxNow = new Date(now.getTime() + OFFSET_MIN * 60 * 1000);
    // Inicio de hoy en CDMX (medianoche pared)
    const cdmxTodayStart = new Date(Date.UTC(
        cdmxNow.getUTCFullYear(), cdmxNow.getUTCMonth(), cdmxNow.getUTCDate()
    ));
    // Inicio de ayer en CDMX
    const cdmxYesterdayStart = new Date(cdmxTodayStart.getTime() - 24 * 60 * 60 * 1000);
    // Regresa a UTC real restando el offset
    const after = new Date(cdmxYesterdayStart.getTime() - OFFSET_MIN * 60 * 1000);
    const before = new Date(cdmxTodayStart.getTime() - OFFSET_MIN * 60 * 1000);
    return { after, before };
}

export async function GET(req: NextRequest) {
    if (!authorized(req)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = getServerSupabase();
    const { data: integrations, error } = await supabase
        .from('email_integrations')
        .select('id, email');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Solo el día anterior (CDMX). Ya no se buscan correos más viejos.
    const { after, before } = getYesterdayBoundsCDMX();

    const results: any[] = [];
    for (const integ of integrations || []) {
        try {
            const r = await runEmailSync({
                integrationId: integ.id,
                afterDate: after,
                beforeDate: before,
                markSync: true,
            });
            results.push({ email: integ.email, ...r });
        } catch (e: any) {
            results.push({ email: integ.email, error: e.message });
        }
    }
    return NextResponse.json({
        ok: true,
        window: { after: after.toISOString(), before: before.toISOString() },
        integrations: results,
    });
}
