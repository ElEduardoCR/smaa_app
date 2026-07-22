import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hashPassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

/**
 * POST /api/setup
 * Crea el primer empleado master si no existe ninguno.
 *
 * Requiere header `x-setup-secret: <SETUP_SECRET>`.
 * Solo funciona si la tabla employees está vacía.
 *
 * Body: { username, password, full_name, position?, phone? }
 */
export async function POST(req: Request) {
    const setupSecret = process.env.SETUP_SECRET;
    if (!setupSecret) {
        return NextResponse.json(
            { error: 'SETUP_SECRET no está configurado en el servidor. Agrega SETUP_SECRET a .env.local y reinicia.' },
            { status: 503 }
        );
    }

    const provided = req.headers.get('x-setup-secret');
    if (provided !== setupSecret) {
        return NextResponse.json({ error: 'Secret incorrecto.' }, { status: 403 });
    }

    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Body inválido.' }, { status: 400 }); }

    const { username, password, full_name, position, phone } = body || {};
    if (!username || !password || !full_name) {
        return NextResponse.json({ error: 'username, password y full_name son obligatorios.' }, { status: 400 });
    }
    if (String(password).length < 6) {
        return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
    }

    // Solo si no hay empleados
    const { count } = await supabase.from('employees').select('id', { count: 'exact', head: true });
    if ((count || 0) > 0) {
        return NextResponse.json({ error: 'Ya existen empleados. El setup inicial solo se permite una vez.' }, { status: 409 });
    }

    const { data, error } = await supabase
        .from('employees')
        .insert({
            full_name: String(full_name).trim(),
            username: String(username).trim().toLowerCase(),
            password_hash: hashPassword(String(password)),
            role: 'master',
            position: position?.trim() || 'Administrador',
            phone: phone?.trim() || null,
            is_active: true,
        })
        .select('id, username, full_name, role')
        .single();
    if (error) {
        if ((error as any).code === '23505') {
            return NextResponse.json({ error: 'Ya existe un empleado con ese usuario.' }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, employee: data });
}
