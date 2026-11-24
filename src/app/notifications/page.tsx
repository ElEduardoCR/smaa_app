import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import NotificationsClient from './NotificationsClient';

export const dynamic = 'force-dynamic';

// Cada quien ve los avisos de los módulos que puede ver (lo filtra la acción).
export default async function NotificationsPage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/notifications');
    return <NotificationsClient />;
}
