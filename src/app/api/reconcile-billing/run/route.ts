import { NextResponse } from 'next/server';
import { reconcileBilling } from '@/lib/reconcileBilling';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min en Vercel

// Disparo manual desde la bandeja ("Detectar ahora").
export async function POST() {
    try {
        const summary = await reconcileBilling();
        return NextResponse.json({ ok: true, ...summary });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
