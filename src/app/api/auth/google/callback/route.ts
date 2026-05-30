import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { encryptToken } from '@/lib/crypto';
import { exchangeCodeForTokens, getUserEmail } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const err = url.searchParams.get('error');

    if (err) return NextResponse.redirect(new URL(`/settings?gmail_error=${encodeURIComponent(err)}`, req.url));
    if (!code || !state) return NextResponse.redirect(new URL('/settings?gmail_error=missing_params', req.url));

    const cookieStore = await cookies();
    const expected = cookieStore.get('g_oauth_state')?.value;
    if (!expected || expected !== state) {
        return NextResponse.redirect(new URL('/settings?gmail_error=state_mismatch', req.url));
    }

    try {
        const tokens = await exchangeCodeForTokens(code);
        if (!tokens.refresh_token) {
            return NextResponse.redirect(new URL('/settings?gmail_error=no_refresh_token', req.url));
        }
        const email = await getUserEmail(tokens.access_token);
        const encrypted = encryptToken(tokens.refresh_token);

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { error: upsertErr } = await supabase
            .from('email_integrations')
            .upsert(
                {
                    provider: 'gmail',
                    email,
                    refresh_token_encrypted: encrypted,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'provider,email' }
            );

        if (upsertErr) {
            return NextResponse.redirect(new URL(`/settings?gmail_error=${encodeURIComponent(upsertErr.message)}`, req.url));
        }

        const res = NextResponse.redirect(new URL('/settings?gmail_connected=1', req.url));
        res.cookies.delete('g_oauth_state');
        return res;
    } catch (e: any) {
        return NextResponse.redirect(new URL(`/settings?gmail_error=${encodeURIComponent(e.message)}`, req.url));
    }
}
