/** Isolated local DB test. Never reads production configuration or credentials. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDigitalTestDatabase } from './digital-test-db';
import { hashPassword, verifyPassword } from '../src/lib/passwordHash';
import { requiresEmployeePassword } from '../src/lib/employeeAuth';

async function main() {
    const test = await createDigitalTestDatabase();
    const { client, roles } = test;
    try {
        await client.query(`ALTER TABLE employees ADD COLUMN password_hash text NOT NULL DEFAULT '',
            ADD COLUMN phone text,ADD COLUMN photo_url text,ADD COLUMN last_login_at timestamptz,
            ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
            CREATE TABLE employee_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_id uuid REFERENCES employees(id),
                module_code text,can_view boolean DEFAULT false,can_edit boolean DEFAULT false);
            ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
            ALTER TABLE employee_permissions ENABLE ROW LEVEL SECURITY;
            CREATE POLICY legacy_employee_access ON employees FOR ALL USING(true) WITH CHECK(true);
            CREATE POLICY legacy_permission_access ON employee_permissions FOR ALL USING(true) WITH CHECK(true);
            GRANT ALL ON employees,employee_permissions TO ${roles.anon},${roles.authenticated};
            GRANT SELECT ON change_log TO ${roles.anon},${roles.authenticated};
            GRANT SELECT(password_hash),UPDATE(role,password_hash) ON employees TO ${roles.anon},${roles.authenticated};`);
        const sql = readFileSync('supabase/migrations/20261117175122_private_employee_credentials_and_permissions.sql', 'utf8')
            .replace(/\banon\b/g, roles.anon).replace(/\bauthenticated\b/g, roles.authenticated).replace(/\bservice_role\b/g, roles.service);
        await client.query(sql);
        // The migration can be safely rerun and strips legacy column grants.
        await client.query(sql);
        const credential = hashPassword('Contraseña QA aislada');
        const employee = (await client.query(`INSERT INTO employees(full_name,username,role,password_hash)
            VALUES('Administrador QA','qa_privacy_admin','admin',$1) RETURNING id`, [credential])).rows[0];
        await client.query("INSERT INTO employee_permissions(employee_id,module_code,can_view) VALUES($1,'documents',true)", [employee.id]);
        await client.query(`INSERT INTO change_log(entity_type,entity_id,action,field_name,new_value,source)
            VALUES('employee',$1,'update','password_hash',$2,'test'),('employee',$1,'update','position','QA','test')`, [employee.id, credential]);
        for (const role of [roles.anon, roles.authenticated]) {
            await client.query(`SET ROLE ${role}`);
            const profile = (await client.query('SELECT id,full_name,username,role,position,photo_url,is_active FROM employees')).rows[0];
            assert.equal(profile.username, 'qa_privacy_admin');
            assert(!('password_hash' in profile));
            await assert.rejects(client.query('SELECT password_hash FROM employees'), /permission denied/);
            await assert.rejects(client.query('SELECT * FROM employees'), /permission denied/);
            await assert.rejects(client.query("UPDATE employees SET role='master' WHERE id=$1", [employee.id]), /permission denied/);
            await assert.rejects(client.query("UPDATE employees SET password_hash='forged' WHERE id=$1", [employee.id]), /permission denied/);
            await assert.rejects(client.query("INSERT INTO employees(full_name,role) VALUES('Forged','master')"), /permission denied/);
            await assert.rejects(client.query('DELETE FROM employees WHERE id=$1', [employee.id]), /permission denied/);
            await assert.rejects(client.query('SELECT * FROM employee_permissions'), /permission denied/);
            await assert.rejects(client.query("INSERT INTO employee_permissions(employee_id,module_code,can_view) VALUES($1,'documents',true)", [employee.id]), /permission denied/);
            await assert.rejects(client.query('UPDATE employee_permissions SET can_edit=true'), /permission denied/);
            await assert.rejects(client.query('DELETE FROM employee_permissions'), /permission denied/);
            const log = (await client.query("SELECT field_name FROM change_log WHERE entity_type='employee'")).rows;
            assert.deepEqual(log.map(row => row.field_name), ['position']);
            await client.query('RESET ROLE');
        }
        // Restrictive policies still block mutation if table grants are restored.
        await client.query(`GRANT INSERT,UPDATE,DELETE ON employees TO ${roles.anon};
            GRANT SELECT,INSERT,UPDATE,DELETE ON employee_permissions TO ${roles.anon};
            SET ROLE ${roles.anon}`);
        assert.equal((await client.query("UPDATE employees SET role='master' RETURNING id")).rowCount, 0);
        assert.equal((await client.query('DELETE FROM employees RETURNING id')).rowCount, 0);
        await assert.rejects(client.query("INSERT INTO employees(full_name,role) VALUES('Forged','master')"), /row-level security/);
        assert.equal((await client.query('SELECT * FROM employee_permissions')).rowCount, 0);
        assert.equal((await client.query('UPDATE employee_permissions SET can_edit=true RETURNING id')).rowCount, 0);
        await assert.rejects(client.query("INSERT INTO employee_permissions(employee_id,module_code) VALUES($1,'documents')", [employee.id]), /row-level security/);
        await client.query('RESET ROLE');
        await client.query(`SET ROLE ${roles.service}`);
        const auth = (await client.query('SELECT role,password_hash,is_active FROM employees WHERE id=$1', [employee.id])).rows[0];
        assert.equal(auth.is_active, true); assert.equal(auth.role, 'admin');
        assert(verifyPassword('Contraseña QA aislada', auth.password_hash));
        assert(!verifyPassword('Incorrecta', auth.password_hash));
        assert.equal((await client.query('SELECT * FROM employee_permissions WHERE employee_id=$1', [employee.id])).rowCount, 1);
        assert.equal((await client.query("SELECT new_value FROM change_log WHERE entity_type='employee' AND field_name='password_hash'")).rows[0].new_value, credential);
        await client.query('UPDATE employees SET is_active=false WHERE id=$1', [employee.id]);
        assert.equal((await client.query('SELECT is_active FROM employees WHERE id=$1', [employee.id])).rows[0].is_active, false);
        await client.query('RESET ROLE');
        assert(requiresEmployeePassword('master')); assert(requiresEmployeePassword('admin'));
        for (const role of ['operator', 'document_controller', 'top_management']) assert(!requiresEmployeePassword(role));
        assert(requiresEmployeePassword('unknown'));
        console.log('PASS: safe employee profile projection; private password hashes and permission matrix; public role/credential/permission mutation denied; restrictive RLS despite grants; service credential verification and permission reads; existing passwordless roles preserved.');
    } finally { await test.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
