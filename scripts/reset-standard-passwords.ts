/** One-time reset; never changes login behavior or privileged accounts.
 * Preview: npx tsx scripts/reset-standard-passwords.ts
 * Apply: SMAA_RESET_PASSWORD=... npx tsx scripts/reset-standard-passwords.ts --apply
 * Requires the Supabase CLI linked to the intended project.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, verifyPassword } from '../src/lib/passwordHash';

const projectRef = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
const envText = readFileSync('.env.local', 'utf8');
const configuredUrl = envText.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m)?.[1];
if (!configuredUrl || new URL(configuredUrl).hostname !== `${projectRef}.supabase.co`) {
    throw new Error('El proyecto enlazado no coincide con la configuración de esta aplicación.');
}

const tempDir = mkdtempSync(join(tmpdir(), 'smaa-password-reset-'));
function query<T>(sql: string): T[] {
    const sqlFile = join(tempDir, 'query.sql');
    writeFileSync(sqlFile, sql, { mode: 0o600 });
    const result = execFileSync('supabase', ['db', 'query', '--linked', '--file', sqlFile, '--output', 'json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(result).rows as T[];
}

try {
    // A positive allowlist protects admin, master, Alta Dirección and future roles.
    const users = query<{ id: string; role: string }>(
        "select id, role from public.employees where role in ('operator','document_controller') order by id",
    );
    console.log(JSON.stringify({ project: projectRef, eligible: users.length, applied: false }));
    if (process.argv.includes('--apply')) {
        const password = process.env.SMAA_RESET_PASSWORD;
        if (!password) throw new Error('Falta SMAA_RESET_PASSWORD.');
        if (!users.length) throw new Error('No hay usuarios elegibles.');
        const values = users.map(user => {
            if (!/^[0-9a-f-]{36}$/i.test(user.id)) throw new Error('ID de usuario inválido.');
            const hash = hashPassword(password);
            if (!verifyPassword(password, hash)) throw new Error('No se pudo verificar la contraseña.');
            return `('${user.id}'::uuid, '${hash}')`;
        }).join(',\n');
        const result = query<{ updated: number; privileged_unchanged: boolean }>(`
begin;
lock table public.employees in share row exclusive mode;
create temporary table protected_passwords on commit drop as
select id, password_hash from public.employees where role not in ('operator','document_controller');
create temporary table reset_passwords (id uuid primary key, password_hash text) on commit drop;
insert into reset_passwords values ${values};
update public.employees e set password_hash = r.password_hash
from reset_passwords r where e.id = r.id and e.role in ('operator','document_controller');
do $$ begin
 if exists (select 1 from reset_passwords r left join public.employees e on e.id = r.id
            where e.id is null or e.password_hash is distinct from r.password_hash) then
   raise exception 'El conjunto de usuarios cambió; no se aplicó el restablecimiento.';
 end if;
 if exists (select 1 from protected_passwords p join public.employees e on e.id = p.id
            where e.password_hash is distinct from p.password_hash) then
   raise exception 'Se detectó un cambio en una cuenta protegida; operación cancelada.';
 end if;
end $$;
select count(*)::int as updated, true as privileged_unchanged from reset_passwords;
commit;
`);
        console.log(JSON.stringify({ project: projectRef, applied: true, result }));
    }
} finally {
    rmSync(tempDir, { recursive: true, force: true });
}
