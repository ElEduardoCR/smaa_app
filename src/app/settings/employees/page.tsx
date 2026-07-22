import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { listAllEmployees } from '@/lib/employees';
import EmployeesClient from './EmployeesClient';

export default async function EmployeesPage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/settings/employees');

    const canView = session.role === 'master' ||
        session.permissions.some((p) => p.module_code === 'employees' && p.can_view);
    if (!canView) redirect('/?denied=1');

    const employees = await listAllEmployees();

    return (
        <EmployeesClient
            currentUserId={session.employeeId}
            currentUserRole={session.role}
            initialEmployees={employees.map((e) => ({
                id: e.id,
                full_name: e.full_name,
                username: e.username,
                role: e.role,
                position: e.position,
                phone: e.phone,
                photo_url: e.photo_url,
                is_active: e.is_active,
                last_login_at: e.last_login_at,
                created_at: e.created_at,
                permissions: e.permissions.map((p) => ({
                    id: p.id,
                    module_code: p.module_code,
                    sub_code: p.sub_code,
                    can_view: p.can_view,
                    can_create: p.can_create,
                    can_edit: p.can_edit,
                    can_delete: p.can_delete,
                    can_start: p.can_start,
                    can_pause: p.can_pause,
                    can_complete: p.can_complete,
                    can_request_supplies: p.can_request_supplies,
                    can_purchase: p.can_purchase,
                })),
            }))}
        />
    );
}
