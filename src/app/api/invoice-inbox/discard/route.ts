import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/emailSync';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const inboxId = body.inboxId as string | undefined;
    const reason = body.reason as string | undefined;
    if (!inboxId) return NextResponse.json({ error: 'inboxId requerido' }, { status: 400 });

    const supabase = getServerSupabase();
    const { error } = await supabase
        .from('invoice_inbox')
        .update({
            status: 'discarded',
            discarded_at: new Date().toISOString(),
            discard_reason: reason || null,
        })
        .eq('id', inboxId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
