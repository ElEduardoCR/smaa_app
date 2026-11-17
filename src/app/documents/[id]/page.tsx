import { requirePermission } from '@/lib/permissionGate';
import { can } from '@/lib/permissions';
import ClientPage from './page.client';
import DigitalDocumentClient from './DigitalDocumentClient';
import { getServerSupabase } from '@/lib/supabaseServer';
import { notFound } from 'next/navigation';
import type { DigitalTemplate } from '@/lib/documents/schema';

export const dynamic = 'force-dynamic';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ control?: string }> }) {
    const session = await requirePermission({ moduleCode: 'documents', action: 'view' });
    // Permisos finos para que el cliente sepa qué botones renderizar.
    // El server (esta función) ya garantizó el view; los siguientes se
    // exponen al cliente para que oculte los controles correspondientes.
    const canEdit = can(session.role, session.permissions, 'documents', 'edit');
    const canDelete = can(session.role, session.permissions, 'documents', 'delete');
    const paramsResolved = await params;
    const query = await searchParams;
    const { data: document, error } = await getServerSupabase().from('documents').select('*').eq('id', paramsResolved.id).maybeSingle();
    if (error) throw new Error('No se pudo consultar el documento.');
    if (!document) notFound();
    if (document.template_schema && document.source_key && query.control !== '1') {
        return <DigitalDocumentClient key={document.id} document={{ id: document.id, folio: document.folio, title: document.title, version: document.version, revision: document.revision, status: document.status }} template={document.template_schema as DigitalTemplate} canCreate={can(session.role, session.permissions, 'documents', 'create')} canEdit={canEdit} />;
    }
    return <ClientPage id={paramsResolved.id} canEdit={canEdit} canDelete={canDelete} />;
}
