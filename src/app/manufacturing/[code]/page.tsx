import { redirect } from 'next/navigation';

// La lista por módulo se unificó: /manufacturing muestra todas las OT y
// permite filtrar por proceso.
export default async function ModulePage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    redirect(`/manufacturing?proceso=${encodeURIComponent(code)}`);
}
