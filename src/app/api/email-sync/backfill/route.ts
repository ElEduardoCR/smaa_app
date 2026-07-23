import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase, runEmailSync } from '@/lib/emailSync';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    // Solo master puede disparar backfills de email (operación admin pesada)
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }
    if (session.role !== 'master') {
        return NextResponse.json({ error: 'Solo master puede ejecutar backfill.' }, { status: 403 });
    }

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
