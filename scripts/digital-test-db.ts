import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';

/** Isolated Homebrew PostgreSQL DB. Never reads .env or uses the Docker ports. */
export async function createDigitalTestDatabase() {
    const suffix = `${process.pid}_${Date.now()}`;
    const database = `smaa_digital_test_${suffix}`;
    const roles = { anon: `smaa_dt_anon_${suffix}`, authenticated: `smaa_dt_auth_${suffix}`, service: `smaa_dt_srv_${suffix}` };
    const admin = new Client({ host: 'localhost', port: 5432, database: 'postgres' });
    await admin.connect();
    const client = new Client({ host: 'localhost', port: 5432, database });
    const cleanup = async () => {
        await client.end().catch(() => undefined);
        await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
        for (const role of Object.values(roles)) await admin.query(`DROP ROLE IF EXISTS ${role}`);
        await admin.end();
    };
    try {
        for (const [kind, role] of Object.entries(roles)) await admin.query(`CREATE ROLE ${role} NOLOGIN ${kind === 'service' ? 'BYPASSRLS' : ''}`);
        await admin.query(`CREATE DATABASE ${database}`);
        await client.connect();
        const sql = (value: string) => value.replace(/\banon\b/g, roles.anon).replace(/\bauthenticated\b/g, roles.authenticated).replace(/\bservice_role\b/g, roles.service);
        await client.query(`
            CREATE TABLE public.employees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),full_name text NOT NULL DEFAULT 'Prueba SMAA',
                username text,role text DEFAULT 'operator',position text,is_active boolean DEFAULT true);
            CREATE FUNCTION public.tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END; $$;
            CREATE SCHEMA storage;
            CREATE TABLE storage.buckets(id text PRIMARY KEY,name text UNIQUE,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        `);
        const base = readFileSync('supabase/migrations/20260721140000_documents_and_change_log.sql', 'utf8').split('-- 8) Generic trigger function')[0];
        await client.query(sql(base));
        await client.query(sql(readFileSync('supabase/migrations/20260811093001_document_requests.sql', 'utf8')));
        const names = readdirSync('supabase/migrations').filter(name => /digital_documents_and_entries|stable_document_request_publication/.test(name)).sort();
        for (const name of names) await client.query(sql(readFileSync(`supabase/migrations/${name}`, 'utf8')));
        await client.query(`GRANT USAGE ON SCHEMA public TO ${roles.anon},${roles.authenticated},${roles.service};
            GRANT SELECT,INSERT,UPDATE,DELETE ON public.documents,public.document_versions,public.document_types,public.document_requests,public.employees,public.change_log TO ${roles.service};`);
        return { client, database, roles, cleanup };
    } catch (error) { await cleanup(); throw error; }
}
