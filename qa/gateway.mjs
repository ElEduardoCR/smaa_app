// Gateway local estilo Kong + emulador de Supabase Storage.
//   /rest/v1/*    → PostgREST (127.0.0.1:54331)
//   /storage/v1/* → emulador en este proceso. Replica las validaciones de
//                   supabase/storage: bucket existente, file_size_limit (y el
//                   límite global de 50 MB del plan Free), allowed_mime_types,
//                   isValidKey() y RLS real de storage.objects (SET LOCAL ROLE).
// Registra cada error de storage en storage-errors.log para la auditoría.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { Pool } = require('pg');
const { jwtVerify, SignJWT } = require('jose');

const QA = path.dirname(new URL(import.meta.url).pathname);
const keys = JSON.parse(fs.readFileSync(path.join(QA, 'keys.json'), 'utf8'));
const SECRET = new TextEncoder().encode(keys.secret);
const DATA = path.join(QA, 'storage-data');
const GLOBAL_LIMIT = Number(process.env.STORAGE_GLOBAL_LIMIT || 50 * 1024 * 1024);
const PORT = 54321;
const ERRLOG = path.join(QA, 'storage-errors.log');

const pool = new Pool({ host: '127.0.0.1', port: 54322, user: 'postgres', database: 'postgres', max: 10 });

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-upsert, cache-control, x-metadata, accept, x-supabase-api-version',
    'access-control-expose-headers': 'content-range, content-length, content-type, etag, x-total-count',
    'access-control-max-age': '86400',
};

function send(res, status, body, headers = {}) {
    const isBuf = Buffer.isBuffer(body);
    const payload = isBuf ? body : JSON.stringify(body);
    res.writeHead(status, { ...CORS, ...(isBuf ? {} : { 'content-type': 'application/json' }), ...headers });
    res.end(payload);
}

function storageError(res, req, statusCode, error, message) {
    fs.appendFileSync(ERRLOG, `${new Date().toISOString()} ${req.method} ${req.url} -> ${statusCode} ${error}: ${message}\n`);
    send(res, 400, { statusCode: String(statusCode), error, message });
}

// --- igual que supabase/storage src/storage/limits.ts ---
function isValidKey(key) {
    return key.length > 0 && /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(key);
}

function mimeAllowed(allowed, mime) {
    if (!allowed || allowed.length === 0) return true;
    const [type] = mime.split(';');
    return allowed.some((a) => {
        if (a === type) return true;
        if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1));
        return false;
    });
}

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
}

async function claimsFrom(req) {
    const auth = req.headers['authorization'] || '';
    const tok = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['apikey'] || '');
    if (!tok) return null;
    try {
        const { payload } = await jwtVerify(tok, SECRET);
        return payload;
    } catch {
        return { invalid: true };
    }
}

async function asRole(claims, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${claims.role === 'service_role' ? 'service_role' : claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
        await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

async function getBucket(id) {
    const { rows } = await pool.query('SELECT * FROM storage.buckets WHERE id=$1', [id]);
    return rows[0] || null;
}

function filePath(bucket, name) {
    return path.join(DATA, bucket, name);
}

async function parseUpload(req, body) {
    const ct = req.headers['content-type'] || 'application/octet-stream';
    if (ct.startsWith('multipart/form-data')) {
        const r = new Request('http://x/', { method: 'POST', headers: { 'content-type': ct }, body });
        const form = await r.formData();
        let file = null;
        for (const [, v] of form.entries()) if (typeof v === 'object' && v && 'arrayBuffer' in v) file = v;
        if (!file) return null;
        return { buf: Buffer.from(await file.arrayBuffer()), mime: file.type || 'application/octet-stream', cacheControl: form.get('cacheControl') || '3600' };
    }
    return { buf: body, mime: ct, cacheControl: (req.headers['cache-control'] || 'max-age=3600').replace('max-age=', '') };
}

async function doUpload(req, res, claims, bucketId, name, upsert, { bypassRls = false } = {}) {
    const bucket = await getBucket(bucketId);
    if (!bucket) return storageError(res, req, 404, 'Bucket not found', 'Bucket not found');
    if (!isValidKey(name)) return storageError(res, req, 400, 'InvalidKey', `Invalid key: ${name}`);
    const body = await readBody(req);
    const up = await parseUpload(req, body);
    if (!up) return storageError(res, req, 400, 'InvalidRequest', 'No file provided');
    const limit = Math.min(GLOBAL_LIMIT, bucket.file_size_limit ? Number(bucket.file_size_limit) : GLOBAL_LIMIT);
    if (up.buf.length > limit) return storageError(res, req, 413, 'Payload too large', 'The object exceeded the maximum allowed size');
    if (!mimeAllowed(bucket.allowed_mime_types, up.mime)) return storageError(res, req, 415, 'invalid_mime_type', `mime type ${up.mime} is not supported`);
    const metadata = { eTag: `"${crypto.createHash('md5').update(up.buf).digest('hex')}"`, size: up.buf.length, mimetype: up.mime, cacheControl: `max-age=${up.cacheControl}`, lastModified: new Date().toISOString(), contentLength: up.buf.length, httpStatusCode: 200 };
    const runner = bypassRls ? { ...claims, role: 'service_role' } : claims;
    let row;
    try {
        row = await asRole(runner, async (c) => {
            const sql = upsert
                ? `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata, version) VALUES ($1,$2,$3,$4,$5,$6)
                   ON CONFLICT (bucket_id, name) DO UPDATE SET metadata=excluded.metadata, version=excluded.version, updated_at=now() RETURNING id`
                : `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata, version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`;
            const sub = claims.sub || null;
            const { rows } = await c.query(sql, [bucketId, name, null, sub, metadata, crypto.randomUUID()]);
            return rows[0];
        });
    } catch (e) {
        if (e.code === '23505') return storageError(res, req, 409, 'Duplicate', 'The resource already exists');
        if (e.code === '42501') return storageError(res, req, 403, 'Unauthorized', 'new row violates row-level security policy');
        return storageError(res, req, 500, 'internal', e.message);
    }
    const fp = filePath(bucketId, name);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, up.buf);
    return send(res, 200, { Key: `${bucketId}/${name}`, Id: row.id });
}

async function serveObject(req, res, bucketId, name) {
    const { rows } = await pool.query('SELECT metadata FROM storage.objects WHERE bucket_id=$1 AND name=$2', [bucketId, name]);
    const fp = filePath(bucketId, name);
    if (!rows[0] || !fs.existsSync(fp)) return storageError(res, req, 404, 'not_found', 'Object not found');
    const md = rows[0].metadata || {};
    return send(res, 200, fs.readFileSync(fp), { 'content-type': md.mimetype || 'application/octet-stream' });
}

async function canSelect(claims, bucketId, name) {
    return asRole(claims, async (c) => {
        const { rows } = await c.query('SELECT 1 FROM storage.objects WHERE bucket_id=$1 AND name=$2', [bucketId, name]);
        return rows.length > 0;
    });
}

async function signToken(payload, expiresIn) {
    return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + Number(expiresIn || 60)).sign(SECRET);
}

async function handleStorage(req, res, p) {
    const u = new URL(p, 'http://x');
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method;

    // Rutas públicas / firmadas (sin Authorization)
    if (parts[0] === 'object' && parts[1] === 'public' && (method === 'GET' || method === 'HEAD')) {
        const [bucketId, ...rest] = parts.slice(2);
        const bucket = await getBucket(bucketId);
        if (!bucket) return storageError(res, req, 404, 'Bucket not found', 'Bucket not found');
        if (!bucket.public) return storageError(res, req, 400, 'InvalidRequest', 'Bucket is not public');
        return serveObject(req, res, bucketId, rest.join('/'));
    }
    if (parts[0] === 'object' && parts[1] === 'sign' && method === 'GET') {
        try {
            const { payload } = await jwtVerify(u.searchParams.get('token') || '', SECRET);
            const [bucketId, ...rest] = parts.slice(2);
            if (payload.url !== `${bucketId}/${rest.join('/')}`) return storageError(res, req, 400, 'InvalidSignature', 'The url do not match the signature');
            return serveObject(req, res, bucketId, rest.join('/'));
        } catch (e) {
            return storageError(res, req, 400, 'InvalidJWT', e.message);
        }
    }
    if (parts[0] === 'object' && parts[1] === 'upload' && parts[2] === 'sign' && method === 'PUT') {
        try {
            const { payload } = await jwtVerify(u.searchParams.get('token') || '', SECRET);
            const [bucketId, ...rest] = parts.slice(3);
            const name = rest.join('/');
            if (payload.url !== `${bucketId}/${name}`) return storageError(res, req, 400, 'InvalidSignature', 'The url do not match the signature');
            return doUpload(req, res, { role: 'service_role', sub: payload.owner }, bucketId, name, !!payload.upsert, { bypassRls: true });
        } catch (e) {
            return storageError(res, req, 400, 'InvalidJWT', e.message);
        }
    }

    const claims = await claimsFrom(req);
    if (!claims) return storageError(res, req, 400, 'Unauthorized', 'headers must have required property \'authorization\'');
    if (claims.invalid) return storageError(res, req, 400, 'Unauthorized', 'invalid signature');

    if (parts[0] === 'bucket') {
        if (method === 'GET' && parts.length === 1) {
            const rows = await asRole(claims, async (c) => (await c.query('SELECT * FROM storage.buckets')).rows);
            return send(res, 200, rows);
        }
        if (method === 'GET' && parts.length === 2) {
            const rows = await asRole(claims, async (c) => (await c.query('SELECT * FROM storage.buckets WHERE id=$1', [parts[1]])).rows);
            if (!rows[0]) return storageError(res, req, 404, 'Bucket not found', 'Bucket not found');
            return send(res, 200, rows[0]);
        }
        return storageError(res, req, 400, 'NotImplemented', `${method} ${u.pathname}`);
    }

    if (parts[0] !== 'object') return storageError(res, req, 404, 'not_found', `Route ${method}:${u.pathname} not found`);

    if (parts[1] === 'upload' && parts[2] === 'sign' && method === 'POST') {
        const [bucketId, ...rest] = parts.slice(3);
        const name = rest.join('/');
        const bucket = await getBucket(bucketId);
        if (!bucket) return storageError(res, req, 404, 'Bucket not found', 'Bucket not found');
        if (!isValidKey(name)) return storageError(res, req, 400, 'InvalidKey', `Invalid key: ${name}`);
        const upsert = req.headers['x-upsert'] === 'true';
        // canUpload: inserción de prueba con RLS y rollback
        try {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(`SET LOCAL ROLE ${claims.role === 'service_role' ? 'service_role' : 'anon'}`);
                await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
                await client.query('INSERT INTO storage.objects (bucket_id, name) VALUES ($1,$2)', [bucketId, `${name}.__probe_${crypto.randomUUID()}`]);
            } finally {
                await client.query('ROLLBACK').catch(() => {});
                client.release();
            }
        } catch (e) {
            if (e.code === '42501') return storageError(res, req, 403, 'Unauthorized', 'new row violates row-level security policy');
            return storageError(res, req, 500, 'internal', e.message);
        }
        const token = await signToken({ url: `${bucketId}/${name}`, owner: claims.sub, upsert }, 7200);
        return send(res, 200, { url: `/object/upload/sign/${bucketId}/${name}?token=${token}`, token });
    }

    if (parts[1] === 'sign' && method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const [bucketId, ...rest] = parts.slice(2);
        if (rest.length === 0) {
            const out = [];
            for (const pth of body.paths || []) {
                const ok = await canSelect(claims, bucketId, pth);
                if (!ok) { out.push({ error: 'Either the object does not exist or you do not have access to it', path: pth, signedURL: null }); continue; }
                const t = await signToken({ url: `${bucketId}/${pth}` }, body.expiresIn);
                out.push({ error: null, path: pth, signedURL: `/object/sign/${bucketId}/${pth}?token=${t}` });
            }
            return send(res, 200, out);
        }
        const name = rest.join('/');
        if (!(await canSelect(claims, bucketId, name))) return storageError(res, req, 404, 'not_found', 'Object not found');
        const t = await signToken({ url: `${bucketId}/${name}` }, body.expiresIn);
        return send(res, 200, { signedURL: `/object/sign/${bucketId}/${name}?token=${t}` });
    }

    if (parts[1] === 'list' && method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const bucketId = parts[2];
        const prefix = body.prefix ? body.prefix.replace(/\/?$/, '/') : '';
        const rows = await asRole(claims, async (c) => (await c.query(
            "SELECT id, name, updated_at, created_at, last_accessed_at, metadata FROM storage.objects WHERE bucket_id=$1 AND name LIKE $2 ORDER BY name",
            [bucketId, `${prefix === '/' ? '' : prefix}%`])).rows);
        const seen = new Map();
        for (const r of rows) {
            const rel = r.name.slice(prefix === '/' ? 0 : prefix.length);
            const [first, ...more] = rel.split('/');
            if (more.length) { if (!seen.has(first)) seen.set(first, { name: first, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null }); }
            else seen.set(first, { ...r, name: first });
        }
        const list = [...seen.values()].slice(body.offset || 0, (body.offset || 0) + (body.limit || 100));
        return send(res, 200, list);
    }

    if (method === 'DELETE' && parts.length === 2) {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const bucketId = parts[1];
        const deleted = await asRole(claims, async (c) => (await c.query(
            'DELETE FROM storage.objects WHERE bucket_id=$1 AND name = ANY($2) RETURNING id, name, bucket_id, metadata, created_at, updated_at',
            [bucketId, body.prefixes || []])).rows);
        for (const d of deleted) fs.rmSync(filePath(bucketId, d.name), { force: true });
        return send(res, 200, deleted);
    }

    if ((method === 'POST' || method === 'PUT') && parts.length >= 3) {
        const [bucketId, ...rest] = parts.slice(1);
        const upsert = method === 'PUT' || req.headers['x-upsert'] === 'true';
        return doUpload(req, res, claims, bucketId, rest.join('/'), upsert);
    }

    if ((method === 'GET' || method === 'HEAD') && parts.length >= 3) {
        const off = parts[1] === 'authenticated' ? 2 : 1;
        const [bucketId, ...rest] = parts.slice(off);
        const name = rest.join('/');
        if (!(await canSelect(claims, bucketId, name))) return storageError(res, req, 404, 'not_found', 'Object not found');
        return serveObject(req, res, bucketId, name);
    }

    return storageError(res, req, 400, 'NotImplemented', `${method} ${u.pathname}`);
}

function proxyRest(req, res, p) {
    const headers = { ...req.headers, host: '127.0.0.1:54331' };
    const up = http.request({ host: '127.0.0.1', port: 54331, method: req.method, path: p, headers }, (r) => {
        res.writeHead(r.statusCode, { ...r.headers, ...CORS });
        r.pipe(res);
    });
    up.on('error', (e) => send(res, 502, { message: e.message }));
    req.pipe(up);
}

http.createServer(async (req, res) => {
    try {
        if (req.method === 'OPTIONS') return send(res, 204, Buffer.alloc(0));
        if (req.url.startsWith('/rest/v1')) return proxyRest(req, res, req.url.slice('/rest/v1'.length) || '/');
        if (req.url.startsWith('/storage/v1')) return await handleStorage(req, res, req.url.slice('/storage/v1'.length) || '/');
        return send(res, 404, { message: 'no route' });
    } catch (e) {
        fs.appendFileSync(ERRLOG, `${new Date().toISOString()} ${req.method} ${req.url} -> CRASH ${e.stack}\n`);
        send(res, 500, { message: e.message });
    }
}).listen(PORT, '127.0.0.1', () => console.log(`gateway listening on ${PORT}`));
