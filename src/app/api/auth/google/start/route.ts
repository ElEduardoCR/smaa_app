import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirect = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !redirect) {
        return NextResponse.json({ error: 'Faltan GOOGLE_CLIENT_ID o GOOGLE_REDIRECT_URI' }, { status: 500 });
    }

    const state = randomBytes(16).toString('hex');
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/gmail.readonly email profile',
        access_type: 'offline',
        prompt: 'consent',          // fuerza refresh_token
        include_granted_scopes: 'true',
        state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    const res = NextResponse.redirect(url);
    res.cookies.set('g_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 10 * 60, // 10 min
    });
    return res;
}
