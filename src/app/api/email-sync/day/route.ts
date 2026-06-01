import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase, runEmailSync } from '@/lib/emailSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min en Vercel

// Límites de un día concreto en zona CDMX (UTC-6, sin horario de verano desde 2022)
function getDayBoundsCDMX(dateStr: string): { after: Date; before: Date } {
    const OFFSET_MIN = -6 * 60; // CDMX = UTC-6
    const [y, m, d] = dateStr.split('-').map(Number);
    // Medianoche CDMX del día solicitado, representada como UTC
    const cdmxDayStart = Date.UTC(y, m - 1, d);
    // Regresa al instante UTC real
    const after = new Date(cdmxDayStart - OFFSET_MIN * 60 * 1000);
    const before = new Date(cdmxDayStart + 24 * 60 * 60 * 1000 - OFFSET_MIN * 60 * 1000);
    return { after, before };
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const date = body.date as string | undefined; // "YYYY-MM-DD"
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: 'Fecha (YYYY-MM-DD) requerida' }, { status: 400 });
    }

    const supabase = getServerSupabase();
    const { data: integrations, error } = await supabase
        .from('email_integrations')
        .select('id, email');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!integrations || integrations.length === 0) {
        return NextResponse.json(
            { error: 'No hay ninguna cuenta de correo conectada. Conéctala en Configuración.' },
            { status: 400 }
        );
    }

    const { after, before } = getDayBoundsCDMX(date);

    let scanned = 0, inserted = 0, skipped = 0;
    const errors: { email: string; messageId?: string; error: string }[] = [];

    for (const integ of integrations) {
        try {
            const r = await runEmailSync({
                integrationId: integ.id,
                afterDate: after,
                beforeDate: before,
                markSync: false, // búsqueda ad-hoc: no mueve last_sync_at
            });
            scanned += r.scanned;
            inserted += r.inserted;
            skipped += r.skipped;
            errors.push(...r.errors.map(e => ({ email: integ.email, ...e })));
        } catch (e: any) {
            errors.push({ email: integ.email, error: e.message });
        }
    }

    // Resumen del día (cuenta lo que hay en la bandeja para esa ventana)
    const [{ count: pending }, { count: duplicates }] = await Promise.all([
        supabase
            .from('invoice_inbox')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending')
            .gte('email_date', after.toISOString())
            .lt('email_date', before.toISOString()),
        supabase
            .from('invoice_inbox')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'duplicate')
            .gte('email_date', after.toISOString())
            .lt('email_date', before.toISOString()),
    ]);

    return NextResponse.json({
        ok: true,
        date,
        window: { after: after.toISOString(), before: before.toISOString() },
        scanned,
        inserted,
        skipped,
        pending: pending || 0,
        duplicates: duplicates || 0,
        errors,
    });
}
