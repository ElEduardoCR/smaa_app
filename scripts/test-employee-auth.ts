/** Auth regression tests: actual server modules, in-memory Supabase, no network or real users. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { hashPassword, verifyPassword } from '../src/lib/passwordHash';
import type * as EmployeesModule from '../src/lib/employees';
import type * as AuthPolicyModule from '../src/lib/employeeAuth';
import type * as LoginModule from '../src/app/api/auth/login/route';
import type * as SessionModule from '../src/lib/session';
import type * as ModuleCatalog from '../src/lib/moduleCatalog';

type Row = Record<string, unknown>;

// Load the real TypeScript implementation while replacing only its external boundaries.
// Unknown dependencies fail closed so these tests cannot connect to Supabase by accident.
function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
    const filename = resolve(file);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loaded = { exports: {} };
    const requireMock = (name: string) => {
        if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected test dependency: ${name}`);
        return dependencies[name];
    };
    new Function('require', 'module', 'exports', source)(requireMock, loaded, loaded.exports);
    return loaded.exports as T;
}

function memorySupabase() {
    const tables: Record<string, Row[]> = { employees: [], employee_permissions: [] };
    const failingTables = new Set<string>();
    let nextId = 1;
    const supabase = {
        from(table: string) {
            assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
            const filters: [string, unknown][] = [];
            let operation: 'select' | 'insert' | 'update' = 'select';
            let payload: Row = {};
            let columns = '*';
            let singular = false;
            const query = {
                select(value = '*') { columns = value; return query; },
                eq(column: string, value: unknown) { filters.push([column, value]); return query; },
                insert(value: Row) { operation = 'insert'; payload = value; return query; },
                update(value: Row) { operation = 'update'; payload = value; return query; },
                maybeSingle() { singular = true; return query; },
                single() { singular = true; return query; },
                order() { return query; },
                async then(onFulfilled: (result: { data: unknown; error: { message: string } | null }) => unknown) {
                    if (failingTables.has(table)) return onFulfilled({ data: null, error: { message: 'Isolated read failure' } });
                    let rows = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
                    if (operation === 'insert') {
                        const row = { id: `test-${nextId++}`, ...payload };
                        tables[table].push(row);
                        rows = [row];
                    } else if (operation === 'update') {
                        rows.forEach(row => Object.assign(row, payload));
                    }
                    const result = rows.map(row => columns === '*' ? { ...row } : Object.fromEntries(columns.split(',').map(key => [key.trim(), row[key.trim()]])));
                    return onFulfilled({ data: singular ? result[0] ?? null : result, error: null });
                },
            };
            return query;
        },
    };
    return { tables, supabase, failingTables };
}

async function main() {
    const policy = loadModule<typeof AuthPolicyModule>('src/lib/employeeAuth.ts', {});
    for (const role of ['operator', 'document_controller', 'top_management']) assert.equal(policy.requiresEmployeePassword(role), false);
    for (const role of ['admin', 'master', 'unknown', '', 'ADMIN']) assert.equal(policy.requiresEmployeePassword(role), true);

    const { tables, supabase, failingTables } = memorySupabase();
    const employees = loadModule<typeof EmployeesModule>('src/lib/employees.ts', {
        'server-only': {}, './supabaseServer': { getServerSupabase: () => supabase },
        './password': { hashPassword, verifyPassword }, './employeeAuth': policy,
    });
    const originalHash = hashPassword('Current#2026');
    const roles = ['operator', 'document_controller', 'top_management', 'admin', 'master', 'unknown'];
    for (const role of roles) {
        tables.employees.push({
            id: role, full_name: `Test ${role}`, username: role, role,
            password_hash: originalHash, is_active: true, position: null, photo_url: null,
        });
        tables.employee_permissions.push({ id: `${role}-permission`, employee_id: role, module_code: 'requisitions', can_view: true });
    }
    tables.employees.push({ id: 'inactive', username: 'inactive', role: 'operator', password_hash: originalHash, is_active: false });

    for (const role of ['operator', 'document_controller', 'top_management']) {
        for (const password of ['', 'wrong password', 'Current#2026']) {
            const result = await employees.authenticateEmployee(`  ${role.toUpperCase()} `, password);
            assert.equal(result?.id, role, `${role} must log in without its old password`);
            assert.equal(result?.permissions[0]?.id, `${role}-permission`, 'Keep the employee permission matrix');
            assert(!Object.hasOwn(result || {}, 'password_hash'), 'Authentication never serializes a credential');
        }
        assert.ok(tables.employees.find(row => row.id === role)?.last_login_at);
    }
    for (const role of ['admin', 'master', 'unknown']) {
        assert.equal(await employees.authenticateEmployee(role, ''), null, `${role} must reject an empty password`);
        assert.equal(await employees.authenticateEmployee(role, 'wrong password'), null, `${role} must reject a wrong password`);
        assert.equal((await employees.authenticateEmployee(role, 'Current#2026'))?.id, role);
        assert.equal(tables.employees.find(row => row.id === role)?.password_hash, originalHash, 'Login must never change a protected password');
    }
    assert.equal(await employees.authenticateEmployee('inactive', ''), null);
    assert.equal(await employees.authenticateEmployee('missing', ''), null);

    for (const role of ['operator', 'document_controller', 'top_management'] as const) {
        const created = await employees.createEmployee({ full_name: ' Test employee ', username: ` NEW_${role} `, role });
        assert(!Object.hasOwn(created, 'password_hash'));
        const row = tables.employees.find(value => value.id === created.id)!;
        assert.equal(row.password_hash, '', 'Passwordless employees store no usable password');
        assert.equal(row.username, `new_${role}`);
        assert.equal((await employees.authenticateEmployee(`new_${role}`, ''))?.id, created.id);
    }
    for (const role of ['admin', 'master'] as const) {
        await assert.rejects(employees.createEmployee({ full_name: 'Protected', username: `missing_${role}`, role }));
        const created = await employees.createEmployee({ full_name: 'Protected', username: `new_${role}`, role, password: 'NewPassword#2026' });
        const row = tables.employees.find(value => value.id === created.id)!;
        assert.equal(verifyPassword('NewPassword#2026', String(row.password_hash)), true);
        const preserved = row.password_hash;
        const updated = await employees.updateEmployee(created.id, { full_name: 'Updated name' });
        assert(!Object.hasOwn(updated, 'password_hash'));
        assert.equal(row.password_hash, preserved, 'Profile edits preserve protected passwords');
        await employees.updateEmployee(created.id, { password: 'Changed#2026' });
        assert.equal(verifyPassword('Changed#2026', String(row.password_hash)), true);
    }

    await employees.updateEmployee('operator', { full_name: 'Operator without legacy password', password: 'Ignored#2026' });
    assert.equal(tables.employees.find(row => row.id === 'operator')?.password_hash, '');
    for (const role of ['admin', 'master'] as const) {
        await assert.rejects(employees.updateEmployee('document_controller', { role }), 'Promotion requires a fresh password even when an old hash exists');
        assert.equal(tables.employees.find(row => row.id === 'document_controller')?.role, 'document_controller');
    }
    await employees.updateEmployee('document_controller', { role: 'admin', password: 'Promotion#2026' });
    assert.equal(await employees.authenticateEmployee('document_controller', ''), null);
    assert.equal((await employees.authenticateEmployee('document_controller', 'Promotion#2026'))?.role, 'admin');
    await employees.updateEmployee('document_controller', { role: 'operator' });
    assert.equal(tables.employees.find(row => row.id === 'document_controller')?.password_hash, '');
    assert.equal((await employees.authenticateEmployee('document_controller', ''))?.role, 'operator');

    assert((await employees.listAllEmployees()).every(employee => !Object.hasOwn(employee, 'password_hash')));
    assert(!Object.hasOwn((await employees.getEmployeeById('admin'))!, 'password_hash'));
    failingTables.add('employee_permissions');
    await assert.rejects(employees.authenticateEmployee('operator', ''), 'Permission read errors fail authentication closed');
    failingTables.clear();

    // Read the current database identity even while a signed cookie says master.
    const catalog = loadModule<typeof ModuleCatalog>('src/lib/moduleCatalog.ts', {});
    const session = loadModule<typeof SessionModule>('src/lib/session.ts', {
        'server-only': {}, 'jose': { jwtVerify: async () => ({ payload: {
            employeeId: 'operator', username: 'stale', fullName: 'Stale cookie', role: 'master', accessList: 'documents:',
        } }) },
        'next/headers': { cookies: async () => ({ get: () => ({ value: 'isolated-test-cookie' }) }) },
        './supabaseServer': { getServerSupabase: () => supabase }, './moduleCatalog': catalog,
    });
    const refreshed = await session.getSession();
    assert.equal(refreshed?.role, 'operator'); assert.equal(refreshed?.username, 'operator');
    assert.equal(refreshed?.accessList, 'requisitions:');
    const operator = tables.employees.find(row => row.id === 'operator')!;
    operator.is_active = false;
    assert.equal(await session.getSession(), null, 'A deactivated account cannot reuse its signed cookie');
    operator.is_active = true;
    failingTables.add('employee_permissions');
    assert.equal(await session.getSession(), null, 'Permission read errors invalidate access, including a master cookie');
    failingTables.clear();
    failingTables.add('employees');
    assert.equal(await session.getSession(), null, 'Identity read errors invalidate access');
    failingTables.clear();

    const sessions: Row[] = [];
    const route = loadModule<typeof LoginModule>('src/app/api/auth/login/route.ts', {
        'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
        '@/lib/employees': employees,
        '@/lib/session': { setSession: async (session: Row) => { sessions.push(session); } },
    });
    const login = (body: unknown) => route.POST(new Request('http://localhost/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const passwordless = await login({ username: 'operator', role: 'master', redirectTo: '/purchases/new' });
    assert.equal(passwordless.status, 200);
    const body = await passwordless.json();
    assert.equal(body.ok, true);
    assert.equal(body.user.role, 'operator', 'Client cannot choose a privileged role');
    assert.equal(body.redirectTo, '/purchases/new');
    assert.equal(sessions.at(-1)?.role, 'operator');
    assert.equal(Object.hasOwn(body.user, 'password_hash'), false);
    const sessionCount = sessions.length;
    for (const role of ['admin', 'master']) {
        assert.equal((await login({ username: role, role: 'operator' })).status, 401);
        assert.equal((await login({ username: role, password: 'wrong', role: 'operator' })).status, 401);
    }
    assert.equal(sessions.length, sessionCount, 'Rejected attempts must not start a session');
    assert.equal((await login({ username: 'admin', password: 'Current#2026' })).status, 200);
    assert.equal((await login({ username: 'inactive' })).status, 401);
    assert.equal((await login({ username: 'missing' })).status, 401);
    assert.equal((await login({})).status, 400);
    const external = await login({ username: 'operator', redirectTo: 'https://example.invalid' });
    assert.equal((await external.json()).redirectTo, '/');
    const invalidJson = await route.POST(new Request('http://localhost/api/auth/login', { method: 'POST', body: '{' }));
    assert.equal(invalidJson.status, 400);

    console.log('PASS: passwordless roles; admin/master passwords; authoritative roles and active status; permissions; creation/profile edits; fresh-password promotion; demotion; login API/session/redirect validation. No network or real user changes.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
