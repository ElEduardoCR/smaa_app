// Genera la configuración local de QA: llaves JWT (anon / service_role) firmadas
// con un secreto local, postgrest.conf y el .env.local que debe usar Next.
// Uso: node qa/setup.mjs   (desde la raíz del repo)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { SignJWT } = require('jose');

const QA = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(QA, '..');
const secret = crypto.randomBytes(32).toString('hex');
const key = new TextEncoder().encode(secret);
const mk = (role) => new SignJWT({ role, iss: 'supabase-local' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime('10y').sign(key);
const keys = { secret, anon: await mk('anon'), service: await mk('service_role') };
fs.writeFileSync(path.join(QA, 'keys.json'), JSON.stringify(keys, null, 1));

fs.writeFileSync(path.join(QA, 'postgrest.conf'), [
    'db-uri = "postgres://authenticator:authenticator@127.0.0.1:54322/postgres"',
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    'db-extra-search-path = "public, extensions"',
    'db-max-rows = 1000',
    'db-pool = 20',
    'server-host = "127.0.0.1"',
    'server-port = 54331',
    `jwt-secret = "${secret}"`,
    'log-level = "warn"',
    '',
].join('\n'));

const envPath = path.join(ROOT, '.env.local');
const env = [
    'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${keys.anon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${keys.service}`,
    `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    'SETUP_SECRET=local-qa-setup-secret',
    'QC_PASS=qa-qc-pass',
    'TIME_CLOCK_AI_PROVIDER=deterministic',
    'NEXT_TELEMETRY_DISABLED=1',
    '',
].join('\n');
if (fs.existsSync(envPath) && !process.argv.includes('--force')) {
    console.log(`.env.local ya existe; no se sobrescribe (usa --force). Valores para QA:\n${env}`);
} else {
    fs.writeFileSync(envPath, env);
}
console.log('Listo: qa/keys.json y qa/postgrest.conf generados.');
