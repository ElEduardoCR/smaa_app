import { requirePermission } from '@/lib/permissionGate';
import ClientPage from './page.client';
import DigitalContentEditor from './DigitalContentEditor';
import { getServerSupabase } from '@/lib/supabaseServer';
import { notFound } from 'next/navigation';
import type { DigitalTemplate } from '@/lib/documents/schema';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
    const { id } = await searchParams;
    await requirePermission({ moduleCode: 'documents', action: id ? 'edit' : 'create' });
    if (id) {
        const { data, error } = await getServerSupabase().from('documents').select('id,source_key,template_schema,revision').eq('id', id).maybeSingle();
        if (error) throw new Error('No se pudo consultar el documento.');
        if (!data) notFound();
        if (data.source_key && data.template_schema) return <DigitalContentEditor documentId={data.id} revision={data.revision} template={data.template_schema as DigitalTemplate} />;
    }
    return <ClientPage />;
}
