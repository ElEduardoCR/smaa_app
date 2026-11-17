/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, CheckCircle2, Download, FileText, History, Loader2, Plus, Printer, Save, Trash2, X } from 'lucide-react';
import SignaturePad from '@/components/manufacturing/SignaturePad';
import { initialDigitalValues, type DigitalField, type DigitalRow, type DigitalSection, type DigitalTemplate, type DigitalValues } from '@/lib/documents/schema';
import { calculateDigitalValues } from '@/lib/documents/calculations';
import { getDigitalRegisterValuesAction } from '@/app/actions/digitalDocumentContent';
import { listControlledDocumentsAction } from '@/app/actions/documentAccess';
import {
    getDigitalEntryAction, getDigitalPdfAction, getDigitalTemplatePdfAction, getDigitalSourceEvidenceAction,
    listDigitalEntriesAction, saveDigitalEntryAction,
    type DigitalEntryDetail, type DigitalEntrySummary,
} from '@/app/actions/digitalDocuments';

type DocumentInfo = { id: string; folio: string; title: string; version: string; revision: number; status: string };
const control = 'w-full min-h-11 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:opacity-75';
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50';
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50';
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación. Intenta nuevamente.';
const displayDate = (date: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chihuahua' }).format(new Date(date));

function ProcessFlow({ flow, title }: { flow: NonNullable<DigitalSection['flow']>; title: string }) {
    const nodes = new Map(flow.nodes.map(node => [node.id, node]));
    const markerId = useId().replaceAll(':', '');
    const rightEdge = Math.max(0, ...flow.nodes.map(node => node.x + node.width));
    const padding = 36;
    return <div className="mt-5 overflow-auto rounded-lg border border-neutral-700 bg-neutral-900 p-4" tabIndex={0} role="region" aria-label={`Diagrama de ${title}`}>
        <svg role="img" aria-label={title} viewBox={`${-padding} ${-padding} ${flow.width + padding * 2} ${flow.height + padding * 2}`} className="h-auto w-full" style={{ minWidth: Math.max(800, flow.width) }}>
            <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="var(--brand)" /></marker></defs>
            {flow.edges.map((edge, index) => {
                const from = nodes.get(edge.from), to = nodes.get(edge.to);
                if (!from || !to) return null;
                const x1 = from.x + from.width / 2, y1 = from.y + from.height;
                const x2 = to.x + to.width / 2, y2 = to.y;
                let path: string, labelX: number, labelY: number;
                if (to.y === from.y) {
                    const right = to.x > from.x;
                    const startX = right ? from.x + from.width : from.x;
                    const endX = right ? to.x : to.x + to.width;
                    const startY = from.y + from.height / 2, endY = to.y + to.height / 2;
                    path = `M ${startX} ${startY} L ${endX} ${endY}`;
                    labelX = (startX + endX) / 2; labelY = (startY + endY) / 2 - 8;
                } else if (to.y < from.y) {
                    const gutter = rightEdge + 24, lowerY = y1 + 16, targetY = to.y + to.height / 2;
                    path = `M ${x1} ${y1} L ${x1} ${lowerY} L ${gutter} ${lowerY} L ${gutter} ${targetY} L ${to.x + to.width} ${targetY}`;
                    labelX = (x1 + gutter) / 2; labelY = lowerY - 6;
                } else {
                    path = `M ${x1} ${y1} L ${x1} ${(y1 + y2) / 2} L ${x2} ${(y1 + y2) / 2} L ${x2} ${y2}`;
                    labelX = (x1 + x2) / 2 + 5; labelY = (y1 + y2) / 2 - 5;
                }
                return <g key={index}><path d={path} stroke="var(--brand)" strokeWidth={1.5} fill="none" markerEnd={`url(#${markerId})`} />{edge.label ? <text x={labelX} y={labelY} fontSize="12" fill="var(--ink-2)">{edge.label}</text> : null}</g>;
            })}
            {flow.nodes.map(node => {
                const words = node.label.split(/\s+/), lines: string[] = [];
                const max = Math.max(12, Math.floor(node.width / 7));
                for (const word of words) {
                    if (lines.length && (lines[lines.length - 1] + ' ' + word).length <= max) lines[lines.length - 1] += ' ' + word;
                    else lines.push(word);
                }
                const fontSize = Math.min(13, Math.max(9, (node.height - 12) / (lines.length * 1.3)));
                return <g key={node.id}><title>{node.label}</title>{node.decision ? <polygon points={`${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}`} fill="var(--brand-soft)" stroke="var(--brand)" /> : <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="7" fill="var(--surface-1)" stroke="var(--line-strong)" />}
                    <text textAnchor="middle" fill="var(--ink-1)" fontSize={fontSize}>{lines.map((line, index) => <tspan key={index} x={node.x + node.width / 2} y={node.y + node.height / 2 + (index - (lines.length - 1) / 2) * fontSize * 1.3}>{line}</tspan>)}</text>
                </g>;
            })}
        </svg>
    </div>;
}

function FieldControl({ field, value, onChange, disabled, id }: {
    field: DigitalField; value: DigitalRow[string] | undefined; onChange: (value: DigitalRow[string]) => void; disabled: boolean; id: string;
}) {
    const locked = disabled || !!field.readOnly;
    const text = value == null ? '' : String(value);
    if (field.type === 'signature') return <div className="space-y-2">
        {text ? <div className="rounded-lg border border-neutral-700 p-2 bg-white" style={{ background: '#fff' }}><img src={text} alt={`Firma de ${field.label}`} className="h-24 max-w-full object-contain" /></div> : null}
        {!locked && !text ? <div className="max-w-full overflow-x-auto"><SignaturePad width={260} height={130} color="#ea580c" label={field.label} saveLabel="Usar esta firma" onSave={signature => onChange(signature)} /></div> : null}
        {!locked && text ? <button type="button" className={secondary} onClick={() => onChange('')}>Cambiar firma</button> : null}
        {locked && !text ? <p className="text-sm text-neutral-400">Sin firma</p> : null}
    </div>;
    if (field.readOnly) return <p id={id} className="min-w-36 whitespace-pre-wrap py-2 text-sm text-neutral-200">{text || '—'}</p>;
    if (field.type === 'checkbox') return <label className="flex min-h-11 items-center gap-3 text-sm"><input id={id} type="checkbox" checked={value === true} disabled={locked} onChange={event => onChange(event.target.checked)} className="h-5 w-5 accent-orange-600" />{value === true ? 'Sí' : 'No'}</label>;
    if (field.type === 'select') return <select id={id} aria-label={field.label} className={control} value={text} disabled={locked} onChange={event => onChange(event.target.value)}><option value="">Seleccionar…</option>{field.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>;
    if (field.type === 'textarea') return <textarea id={id} aria-label={field.label} rows={3} className={`${control} min-w-48 resize-y`} value={text} disabled={locked} placeholder={field.placeholder} onChange={event => onChange(event.target.value)} />;
    return <input id={id} aria-label={field.label} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'number' ? 'any' : undefined} min={field.min} max={field.max} className={`${control} min-w-32`} value={text} disabled={locked} placeholder={field.placeholder} onChange={event => onChange(field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />;
}

function TemplateBody({ template, values, onChange, disabled }: {
    template: DigitalTemplate; values: DigitalValues; onChange: (key: string, value: DigitalValues[string]) => void; disabled: boolean;
}) {
    return <div className="space-y-5">{template.sections.map((section, sectionIndex) => {
        const table = section.table;
        const rows = table && Array.isArray(values[table.key]) ? values[table.key] as DigitalRow[] : [];
        return <section key={`${sectionIndex}-${section.title}`} className="rounded-xl border border-neutral-700 bg-neutral-800 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-white">{section.title}</h2>
            {section.paragraphs?.map((paragraph, index) => <p key={index} className="mt-3 whitespace-pre-wrap text-sm leading-7 text-neutral-300">{paragraph}</p>)}
            {section.flow ? <ProcessFlow flow={section.flow} title={section.title} /> : null}
            {section.fields?.length ? <div className="mt-5 grid gap-5 sm:grid-cols-2">{section.fields.map(field => <div key={field.key} className={field.type === 'textarea' || field.type === 'signature' ? 'sm:col-span-2' : ''}>
                <label htmlFor={`${sectionIndex}-${field.key}`} className="mb-2 block text-sm font-medium text-neutral-200">{field.label}{field.required ? <span className="text-orange-400"> *</span> : null}</label>
                <FieldControl id={`${sectionIndex}-${field.key}`} field={field} value={Array.isArray(values[field.key]) ? '' : values[field.key] as DigitalRow[string]} disabled={disabled} onChange={value => onChange(field.key, value)} />
            </div>)}</div> : null}
            {table ? <div className="mt-5 space-y-3">
                <p className="text-sm font-medium text-neutral-200">{table.label}</p>
                <div className="relative overflow-x-auto rounded-lg border border-neutral-700" role="region" aria-label={table.label} tabIndex={0}>
                    <table className="w-full text-left text-sm"><thead className="bg-neutral-900"><tr>{table.columns.map(column => <th key={column.key} className="min-w-36 px-3 py-3 font-medium text-neutral-300">{column.label}{column.required ? ' *' : ''}</th>)}{!disabled && !table.fixedRows ? <th className="px-3 py-3"><span className="sr-only">Acciones de fila</span></th> : null}</tr></thead>
                        <tbody className="divide-y divide-neutral-700">{rows.map((row, rowIndex) => <tr key={rowIndex} className="align-top">{table.columns.map(column => <td key={column.key} className="min-w-40 px-3 py-3"><FieldControl id={`${table.key}-${rowIndex}-${column.key}`} field={column} value={row[column.key]} disabled={disabled} onChange={value => onChange(table.key, rows.map((old, index) => index === rowIndex ? { ...old, [column.key]: value } : old))} /></td>)}{!disabled && !table.fixedRows ? <td className="px-2 py-3"><button type="button" aria-label={`Eliminar fila ${rowIndex + 1} de ${table.label}`} className="min-h-11 min-w-11 rounded-lg text-rose-400 hover:bg-rose-500/10 disabled:opacity-30" disabled={rows.length <= (table.minRows ?? 0)} onClick={() => onChange(table.key, rows.filter((_, index) => index !== rowIndex))}><Trash2 className="mx-auto h-4 w-4" /></button></td> : null}</tr>)}</tbody>
                    </table>
                </div>
                {!disabled && !table.fixedRows ? <button type="button" className={secondary} disabled={rows.length >= (table.maxRows ?? 200)} onClick={() => onChange(table.key, [...rows, Object.fromEntries(table.columns.map(column => [column.key, '']))])}><Plus className="h-4 w-4" /> Agregar fila</button> : null}
                {rows.length === 0 ? <p className="text-sm text-neutral-400">Sin registros.</p> : null}
            </div> : null}
        </section>;
    })}</div>;
}

export default function DigitalDocumentClient({ document, template, canCreate, canEdit }: {
    document: DocumentInfo; template: DigitalTemplate; canCreate: boolean; canEdit: boolean;
}) {
    const [entries, setEntries] = useState<DigitalEntrySummary[]>([]);
    const [entry, setEntry] = useState<DigitalEntryDetail | null>(null);
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState<DigitalValues>(() => initialDigitalValues(template));
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
    const [tab, setTab] = useState<'document' | 'entries'>('document');
    const [relatedDocuments, setRelatedDocuments] = useState<{ id: string; folio: string; title: string }[]>([]);
    const activeTemplate = entry?.template_snapshot || template;
    const shownCode = editing && entry ? activeTemplate.code : document.folio;
    const shownTitle = editing && entry ? activeTemplate.title : document.title;
    const shownVersion = editing && entry ? entry.template_version : document.version;
    const shownRevision = editing && entry ? entry.template_revision : document.revision;
    const hasCapture = template.captureEnabled !== false && template.sections.some(section => section.fields?.length || section.table);
    const readOnly = !editing || !!entry && !entry.can_edit;
    const summaries = useMemo(() => calculateDigitalValues(activeTemplate, values), [activeTemplate, values]);

    const loadEntries = useCallback(async () => {
        setLoading(true);
        try {
            const [saved, catalogue] = await Promise.all([listDigitalEntriesAction(document.id), listControlledDocumentsAction()]);
            setEntries(saved); setRelatedDocuments(catalogue);
        }
        catch (error) { setNotice({ error: true, text: messageOf(error) }); }
        finally { setLoading(false); }
    }, [document.id]);
    useEffect(() => { void loadEntries(); }, [loadEntries]);
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const changeValue = (key: string, value: DigitalValues[string]) => { setValues(current => ({ ...current, [key]: value })); setDirty(true); };
    const discardAllowed = () => !dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');
    const newEntry = async () => {
        if (!discardAllowed()) return;
        setBusy(true); setNotice(null);
        try {
            const initial = template.kind === 'register' ? await getDigitalRegisterValuesAction(document.id) : initialDigitalValues(template);
            setEntry(null); setValues(initial); setEditing(true); setDirty(false); setTab('document');
        } catch (error) { setNotice({ error: true, text: messageOf(error) }); }
        finally { setBusy(false); }
    };
    const openEntry = async (id: string) => {
        if (!discardAllowed()) return;
        setBusy(true); setNotice(null);
        try { const loaded = await getDigitalEntryAction(id); setEntry(loaded); setValues(loaded.values); setEditing(true); setDirty(false); setTab('document'); }
        catch (error) { setNotice({ error: true, text: messageOf(error) }); }
        finally { setBusy(false); }
    };
    const save = async (status: 'draft' | 'finalized') => {
        if (status === 'finalized' && !window.confirm('Al finalizar se conservará esta captura y su PDF sin permitir más cambios. Revisa los datos y firmas antes de continuar.')) return;
        setBusy(true); setNotice(null);
        try {
            const result = await saveDigitalEntryAction({ documentId: document.id, entryId: entry?.id, expectedRevision: entry?.revision, expectedTemplateVersion: document.version, expectedTemplateRevision: document.revision, values, status });
            const loaded = await getDigitalEntryAction(result.id);
            setEntry(loaded); setValues(loaded.values); setDirty(false);
            setNotice({ error: false, text: `${status === 'finalized' ? 'Captura finalizada' : 'Borrador guardado'}. El PDF de la revisión ${result.revision} quedó guardado y está disponible para descargar e imprimir.` });
            await loadEntries();
        } catch (error) { setNotice({ error: true, text: messageOf(error) }); }
        finally { setBusy(false); }
    };
    const openPdf = async (id?: string, revision?: number, download = false) => {
        const popup = download ? null : window.open('about:blank', '_blank');
        if (popup) popup.opener = null;
        setBusy(true);
        try {
            const url = id ? await getDigitalPdfAction(id, revision, download ? 'download' : 'inline') : await getDigitalTemplatePdfAction(document.id, download ? 'download' : 'inline');
            if (download) { const link = window.document.createElement('a'); link.href = url; link.rel = 'noopener'; link.click(); }
            else if (popup) popup.location.href = url;
            else { setNotice({ error: false, text: 'El PDF está listo. Permite las ventanas emergentes para abrirlo.' }); }
        } catch (error) { popup?.close(); setNotice({ error: true, text: messageOf(error) }); }
        finally { setBusy(false); }
    };
    const closeEntry = () => { if (!discardAllowed()) return; setEditing(false); setEntry(null); setDirty(false); setValues(initialDigitalValues(template)); };
    const openEvidence = async (sha256: string) => {
        const popup = window.open('about:blank', '_blank');
        if (popup) popup.opener = null;
        setBusy(true);
        try {
            const url = await getDigitalSourceEvidenceAction(document.id, sha256);
            if (popup) popup.location.href = url;
            else setNotice({ error: false, text: 'Permite las ventanas emergentes para abrir el original.' });
        } catch (error) { popup?.close(); setNotice({ error: true, text: messageOf(error) }); }
        finally { setBusy(false); }
    };

    return <div className="min-h-screen bg-[var(--app-bg)] p-3 text-neutral-200 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="rounded-xl border border-neutral-700 bg-neutral-800 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="flex min-w-0 items-start gap-4"><Link href="/documents" aria-label="Volver al catálogo" className={`${secondary} shrink-0`}><ArrowLeft className="h-5 w-5" /></Link><div className="min-w-0"><p className="font-mono text-sm font-semibold text-orange-400">{shownCode} <span className="ml-2 font-sans text-neutral-400">{activeTemplate.area}</span></p><h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{shownTitle}</h1><p className="mt-2 text-sm text-neutral-400">SMAA S.A. de C.V. · Versión {shownVersion} · Revisión {shownRevision}</p></div></div>
                    <div className="flex flex-wrap gap-2"><button className={secondary} disabled={busy} onClick={() => void openPdf(undefined, undefined, true)}><Download className="h-4 w-4" /> {hasCapture ? 'Descargar formato PDF' : 'Descargar PDF'}</button><button className={secondary} disabled={busy} onClick={() => void openPdf()}><Printer className="h-4 w-4" /> Imprimir PDF</button>{hasCapture && canCreate ? <button className={primary} disabled={busy} onClick={() => void newEntry()}><Plus className="h-4 w-4" /> Llenar formato</button> : null}{canEdit && !editing ? <Link href={`/documents/new?id=${document.id}`} className={secondary}>Editar contenido</Link> : null}<Link href={`/documents/${document.id}?control=1`} className={secondary}>Historial y firmas</Link></div>
                </div>
                <p className="mt-5 max-w-4xl text-sm leading-6 text-neutral-300">{template.description}</p>
                {template.needsAdaptation ? <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">Documento en borrador. Revisa los responsables y las reglas pendientes antes de aprobarlo como vigente.</p> : null}
                {template.normativeBaseline ? <p className="mt-4 text-sm font-medium text-neutral-200">{template.normativeBaseline}{template.transitionNote ? ` · ${template.transitionNote}` : ''}</p> : null}
                {template.sourceEvidence?.length ? <div className="mt-4 flex flex-wrap gap-2">{template.sourceEvidence.map(source => <button type="button" key={source.sha256} disabled={busy} className={secondary} onClick={() => void openEvidence(source.sha256)}><FileText className="h-4 w-4" /> {source.label}</button>)}</div> : null}
                {template.relatedCodes?.length ? <div className="mt-5 border-t border-neutral-700 pt-4"><p className="mb-3 text-sm font-medium text-neutral-300">Documentos relacionados</p><div className="flex flex-wrap gap-2">{template.relatedCodes.map(code => {
                    const linked = relatedDocuments.find(item => item.folio === code);
                    return linked ? <Link key={code} href={`/documents/${linked.id}`} title={linked.title} className={secondary}><span className="font-mono">{code}</span><span className="max-w-64 truncate">{linked.title}</span></Link> : <span key={code} className="rounded-lg border border-neutral-700 px-3 py-2 font-mono text-sm text-neutral-400">{code}</span>;
                })}</div></div> : null}
            </header>

            {notice ? <div role={notice.error ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border p-4 text-sm ${notice.error ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}><p>{notice.text}</p><button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)} className="min-h-8 min-w-8"><X className="mx-auto h-4 w-4" /></button></div> : null}

            {!editing && hasCapture ? <nav aria-label="Vistas del formato" className="flex gap-2 border-b border-neutral-700 pb-3"><button className={tab === 'document' ? primary : secondary} onClick={() => setTab('document')}><BookOpen className="h-4 w-4" /> Formato</button><button className={tab === 'entries' ? primary : secondary} onClick={() => setTab('entries')}><History className="h-4 w-4" /> Capturas guardadas ({entries.length})</button></nav> : null}

            {editing ? <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
                <div><h2 className="font-semibold text-white">{entry ? entry.folio : 'Nueva captura'}</h2><p className="mt-1 text-sm text-neutral-400">{entry ? `Revisión ${entry.revision} · ${entry.status === 'finalized' ? 'Finalizada' : 'Borrador'} · ${entry.created_by_name}` : 'Los campos con * se requieren para finalizar.'}{dirty ? ' · Cambios sin guardar' : ''}</p></div>
                <div className="flex flex-wrap gap-2">{entry ? <><button disabled={busy} className={secondary} onClick={() => void openPdf(entry.id, undefined, true)}><Download className="h-4 w-4" /> Descargar PDF</button><button disabled={busy} className={secondary} onClick={() => void openPdf(entry.id)}><Printer className="h-4 w-4" /> Abrir / imprimir PDF</button></> : null}<button disabled={busy} className={secondary} onClick={closeEntry}>Cerrar captura</button></div>
            </div> : null}
            {editing && !readOnly && template.key === 'indice-revisiones' ? <button className={secondary} disabled={busy} onClick={async () => {
                setBusy(true);
                try { const loaded = await getDigitalRegisterValuesAction(document.id, String(values.codigo_documento || '')); setValues(current => ({ ...current, codigo_documento: loaded.codigo_documento, nombre_documento: loaded.nombre_documento, revisiones: loaded.revisiones })); setDirty(true); }
                catch (error) { setNotice({ error: true, text: messageOf(error) }); }
                finally { setBusy(false); }
            }}>Cargar revisiones del código capturado</button> : null}

            {tab === 'entries' && !editing ? <section className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
                {loading ? <p className="p-10 text-center text-neutral-400">Cargando capturas…</p> : entries.length === 0 ? <div className="space-y-3 p-10 text-center"><FileText className="mx-auto h-9 w-9 text-neutral-400" /><p className="font-medium text-white">Todavía no hay capturas</p><p className="text-sm text-neutral-400">Llena el formato y guarda su primera revisión con PDF.</p>{canCreate ? <button className={primary} onClick={newEntry}>Llenar formato</button> : null}</div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-neutral-900 text-neutral-400"><tr><th className="p-4">Folio</th><th className="p-4">Responsable</th><th className="p-4">Actualización</th><th className="p-4">Estado</th><th className="p-4">Acciones</th></tr></thead><tbody className="divide-y divide-neutral-700">{entries.map(item => <tr key={item.id}><td className="p-4 font-mono">{item.folio}<p className="mt-1 font-sans text-xs text-neutral-400">Revisión {item.revision}</p></td><td className="p-4">{item.created_by_name}</td><td className="p-4 whitespace-nowrap text-neutral-400">{displayDate(item.updated_at)}</td><td className="p-4">{item.status === 'finalized' ? 'Finalizada' : 'Borrador'}</td><td className="p-4"><div className="flex gap-2"><button disabled={busy} className={secondary} onClick={() => void openEntry(item.id)}>Abrir</button><button disabled={busy} className={secondary} onClick={() => void openPdf(item.id)}><Download className="h-4 w-4" /> PDF</button></div></td></tr>)}</tbody></table></div>}
            </section> : <>
                <TemplateBody template={activeTemplate} values={values} onChange={changeValue} disabled={readOnly} />
                {editing && summaries.length ? <section className="rounded-xl border border-neutral-700 bg-neutral-800 p-5"><h2 className="font-semibold text-white">Resultados calculados</h2><dl className="mt-4 grid gap-4 sm:grid-cols-3">{summaries.map(item => <div key={item.label}><dt className="text-sm text-neutral-400">{item.label}</dt><dd className="mt-1 text-lg font-semibold text-white">{item.value}</dd></div>)}</dl></section> : null}
                {editing && entry?.pdf_versions?.length ? <details className="rounded-xl border border-neutral-700 bg-neutral-800 p-4"><summary className="cursor-pointer font-medium text-neutral-200">PDF de cada revisión guardada ({entry.pdf_versions.length})</summary><div className="mt-4 flex flex-wrap gap-2">{entry.pdf_versions.map(pdf => <button key={pdf.revision} disabled={busy} className={secondary} onClick={() => void openPdf(entry.id, pdf.revision)}><Download className="h-4 w-4" /> Revisión {pdf.revision}</button>)}</div></details> : null}
                {editing && !readOnly ? <footer className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-700 bg-neutral-800 p-4 shadow-lg"><p className="text-sm text-neutral-400">Cada guardado conserva una revisión y su PDF.</p><div className="flex flex-wrap gap-2"><button className={secondary} disabled={busy} onClick={() => void save('draft')}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar borrador</button><button className={primary} disabled={busy} onClick={() => void save('finalized')}><CheckCircle2 className="h-4 w-4" /> Finalizar y guardar PDF</button></div></footer> : null}
            </>}
        </div>
    </div>;
}
