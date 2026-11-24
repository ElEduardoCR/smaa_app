import { redirect } from 'next/navigation';

// Enlaces anteriores (/manufacturing/<módulo>/<id>) siguen funcionando.
export default async function LegacyWorkOrderPage({ params }: { params: Promise<{ code: string; id: string }> }) {
    const { id } = await params;
    redirect(`/manufacturing/ot/${id}`);
}
