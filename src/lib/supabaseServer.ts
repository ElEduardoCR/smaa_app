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

/**
 * Igual que getServerSupabase, pero cada cambio que haga queda en la bitácora
 * (audit_log) a nombre del empleado: la base sólo confía en el encabezado
 * `x-smaa-actor` cuando viene con la llave de servicio.
 */
export function getActorSupabase(employeeId: string, reason?: string | null): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !secretKey) {
        throw new Error('La configuración server-only de Supabase está incompleta.');
    }

    return createClient(url, secretKey, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
        },
        global: {
            headers: {
                'x-smaa-actor': employeeId,
                // Los encabezados HTTP no admiten acentos: el motivo viaja en base64.
                ...(reason?.trim() ? { 'x-smaa-reason': Buffer.from(reason.trim().slice(0, 1000), 'utf8').toString('base64') } : {}),
            },
        },
    });
}
