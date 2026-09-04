import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serverClient: SupabaseClient | null = null;

/** Supabase elevado para rutas backend que ya hicieron su propia autorización. */
export function getServerSupabase(): SupabaseClient {
    if (serverClient) return serverClient;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !secretKey) {
        throw new Error('La configuración server-only de Supabase está incompleta.');
    }

    serverClient = createClient(url, secretKey, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
        },
    });

    return serverClient;
}
