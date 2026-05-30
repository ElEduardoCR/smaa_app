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

export async function GET(req: NextRequest) {
    if (!authorized(req)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = getServerSupabase();
    const { data: integrations, error } = await supabase
        .from('email_integrations')
        .select('id, email');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const results: any[] = [];
    for (const integ of integrations || []) {
        try {
            const r = await runEmailSync({ integrationId: integ.id });
            results.push({ email: integ.email, ...r });
        } catch (e: any) {
            results.push({ email: integ.email, error: e.message });
        }
    }
    return NextResponse.json({ ok: true, integrations: results });
}
