'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save } from 'lucide-react';
import { updateDigitalDocumentContentAction } from '@/app/actions/digitalDocumentContent';
import type { DigitalRow, DigitalTemplate } from '@/lib/documents/schema';

const control = 'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40';

export default function DigitalContentEditor({ documentId, revision, template }: { documentId: string; revision: number; template: DigitalTemplate }) {
    const router = useRouter();
    const [title, setTitle] = useState(template.title);
    const [description, setDescription] = useState(template.description);
    const [paragraphs, setParagraphs] = useState(() => template.sections.map(section => (section.paragraphs || []).join('\n\n')));
    const [nodeLabels, setNodeLabels] = useState<Record<string, string>>(() => Object.fromEntries(template.sections.flatMap((section, index) => (section.flow?.nodes || []).map(node => [`${index}:${node.id}`, node.label]))));
    const [controlledTables, setControlledTables] = useState<Record<string, DigitalRow[]>>(() => template.captureEnabled === false ? Object.fromEntries(template.sections.flatMap(section => section.table ? [[section.table.key, section.table.initialRows?.map(row => ({ ...row })) || []]] : [])) : {});
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const save = async () => {
        setBusy(true); setError('');
        try {
            await updateDigitalDocumentContentAction({ documentId, expectedRevision: revision, title, description, paragraphs: paragraphs.map(value => value.split(/\n\s*\n/)), nodeLabels, controlledTables, changeSummary: reason });
            router.push(`/documents/${documentId}`); router.refresh();
        } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar el documento.'); }
        finally { setBusy(false); }
    };
    return <div className="min-h-screen bg-[var(--app-bg)] p-4 text-neutral-200 sm:p-8"><form className="mx-auto max-w-4xl space-y-6" onSubmit={event => { event.preventDefault(); void save(); }}>
        <header className="flex items-start gap-4"><Link href={`/documents/${documentId}`} aria-label="Volver al documento" className="rounded-lg border border-neutral-700 p-3"><ArrowLeft className="h-5 w-5" /></Link><div><p className="font-mono text-sm text-orange-400">{template.code}</p><h1 className="mt-1 text-2xl font-bold text-white">Editar contenido</h1><p className="mt-2 text-sm text-neutral-400">El cambio crea una nueva revisión en borrador. Las capturas y sus PDF anteriores conservan su contenido original.</p></div></header>
        {error ? <p role="alert" className="rounded-lg bg-rose-500/10 p-4 text-sm text-rose-300">{error}</p> : null}
        <section className="space-y-5 rounded-xl border border-neutral-700 bg-neutral-800 p-5"><label className="block text-sm font-medium">Título<input className={`${control} mt-2`} value={title} onChange={event => setTitle(event.target.value)} maxLength={300} required /></label><label className="block text-sm font-medium">Descripción<textarea className={`${control} mt-2`} rows={3} value={description} onChange={event => setDescription(event.target.value)} maxLength={5000} /></label></section>
        {template.sections.map((section, index) => <section key={index} className="space-y-4 rounded-xl border border-neutral-700 bg-neutral-800 p-5"><h2 className="font-semibold text-white">{section.title}</h2><label className="block text-sm text-neutral-300">Contenido e instrucciones<textarea className={`${control} mt-2`} rows={Math.floor(Math.min(20, Math.max(4, (section.paragraphs || []).join('\n').length / 100)))} value={paragraphs[index]} onChange={event => setParagraphs(current => current.map((value, i) => i === index ? event.target.value : value))} /></label>{section.flow?.nodes.map(node => <label key={node.id} className="block text-sm text-neutral-300">Texto de actividad del mapa<input className={`${control} mt-2`} value={nodeLabels[`${index}:${node.id}`]} onChange={event => setNodeLabels(current => ({ ...current, [`${index}:${node.id}`]: event.target.value }))} /></label>)}{section.table && template.captureEnabled === false ? <div className="relative overflow-x-auto rounded-lg border border-neutral-700" role="region" aria-label={`Editar ${section.table.label}`} tabIndex={0}><table className="w-full text-left text-sm"><thead><tr>{section.table.columns.map(column => <th key={column.key} className="min-w-40 p-3 font-medium">{column.label}</th>)}</tr></thead><tbody>{(controlledTables[section.table.key] || []).map((row, rowIndex) => <tr key={rowIndex}>{section.table!.columns.map(column => <td key={column.key} className="min-w-44 p-2 align-top"><label className="sr-only" htmlFor={`table-${section.table!.key}-${rowIndex}-${column.key}`}>{column.label}, fila {rowIndex + 1}</label><textarea id={`table-${section.table!.key}-${rowIndex}-${column.key}`} className={control} rows={3} value={String(row[column.key] ?? '')} onChange={event => setControlledTables(current => ({ ...current, [section.table!.key]: current[section.table!.key].map((existing, i) => i === rowIndex ? { ...existing, [column.key]: event.target.value } : existing) }))} /></td>)}</tr>)}</tbody></table></div> : section.fields?.length || section.table ? <p className="text-sm text-neutral-400">Los campos y las tablas del formato se conservan en esta revisión.</p> : null}</section>)}
        <section className="rounded-xl border border-neutral-700 bg-neutral-800 p-5"><label className="block text-sm font-medium">Motivo del cambio *<textarea className={`${control} mt-2`} value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={2000} required /></label></section>
        <div className="flex justify-end gap-3"><Link href={`/documents/${documentId}`} className="rounded-lg border border-neutral-700 px-4 py-3 text-sm">Cancelar</Link><button type="submit" disabled={busy} className="flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{busy ? 'Guardando…' : 'Guardar nueva revisión'}</button></div>
    </form></div>;
}
