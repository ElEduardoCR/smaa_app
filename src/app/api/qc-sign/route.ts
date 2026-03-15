import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
    try {
        const { password, work_order_id } = await req.json();

        if (!password || !work_order_id) {
            return NextResponse.json({ ok: false, error: 'Datos incompletos.' }, { status: 400 });
        }

        const qcPass = process.env.QC_PASS;
        if (!qcPass) {
            return NextResponse.json({ ok: false, error: 'QC_PASS no configurado en el servidor.' }, { status: 500 });
        }

        if (password !== qcPass) {
            return NextResponse.json({ ok: false, error: 'Contraseña incorrecta.' }, { status: 401 });
        }

        // Password correct — update work order as QC approved
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { error } = await supabase
            .from('work_orders')
            .update({
                qc_approved: true,
                qc_approved_at: new Date().toISOString(),
            })
            .eq('id', work_order_id);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
