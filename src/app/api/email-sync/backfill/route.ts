import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase, runEmailSync } from '@/lib/emailSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const integrationId = body.integrationId as string | undefined;
    const months = Math.max(1, Math.min(12, Number(body.months ?? 5)));

    if (!integrationId) {
        return NextResponse.json({ error: 'integrationId requerido' }, { status: 400 });
    }

    const supabase = getServerSupabase();
    const { data: integ, error: fetchErr } = await supabase
        .from('email_integrations')
        .select('id, backfill_completed_at')
        .eq('id', integrationId)
        .single();
    if (fetchErr || !integ) {
        return NextResponse.json({ error: 'integración no encontrada' }, { status: 404 });
    }

    const afterDate = new Date();
    afterDate.setMonth(afterDate.getMonth() - months);

    try {
        const result = await runEmailSync({
            integrationId,
            afterDate,
            maxMessages: 2000,
        });

        await supabase
            .from('email_integrations')
            .update({
                backfill_completed_at: new Date().toISOString(),
                backfill_months: months,
            })
            .eq('id', integrationId);

        return NextResponse.json({ ok: true, months, ...result });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
