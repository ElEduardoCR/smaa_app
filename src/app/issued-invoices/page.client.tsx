"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseCFDI } from "@/lib/cfdiParse";
import {
    ArrowLeft, Receipt, RefreshCw, Search, X, Filter, FolderUp, FileCode,
    UploadCloud, CheckCircle, AlertCircle, FileCheck, Check, Wallet,
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const BUCKET = "purchase_files";
const INVOICE_PREFIX = "issued_invoices";

type IssuedInvoice = {
    id: string;
    uuid: string | null;
    serie: string | null;
    folio: string | null;
    invoice_date: string | null;
    emisor_rfc: string | null;
    emisor_nombre: string | null;
    receptor_rfc: string | null;
    receptor_nombre: string | null;
    subtotal: number | null;
    vat_total: number | null;
    total: number | null;
    currency: string | null;
    xml_url: string | null;
    file_name: string | null;
    paid: boolean | null;
    paid_at: string | null;
    created_at: string;
};

type ImportReport = {
    total: number;
    inserted: number;
    duplicates: number;
    invalid: number;
    errors: number;
};

const fmtMoney = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

export default function IssuedInvoicesPage() {
    const [rows, setRows] = useState<IssuedInvoice[]>([]);
    const [loading, setLoading] = useState(true);

    // Filtros
    const [search, setSearch] = useState("");
    const [minValue, setMinValue] = useState("");
    const [maxValue, setMaxValue] = useState("");
    const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "unpaid">("all");
    const [payingId, setPayingId] = useState<string | null>(null);

    // Importación
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [report, setReport] = useState<ImportReport | null>(null);
    const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const folderRef = useRef<HTMLInputElement>(null);
    const filesRef = useRef<HTMLInputElement>(null);

    const fetchInvoices = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("issued_invoices")
                .select("*")
                .order("invoice_date", { ascending: false, nullsFirst: false })
                .order("created_at", { ascending: false })
                .limit(1000);
            if (error) throw error;
            setRows((data as IssuedInvoice[]) || []);
        } catch (e: any) {
            setMsg({ type: "error", text: e.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchInvoices(); }, []);

    const togglePaid = async (row: IssuedInvoice) => {
        const newPaid = !row.paid;
        const newPaidAt = newPaid ? new Date().toISOString() : null;
        setPayingId(row.id);
        // Actualización optimista
        setRows(rs => rs.map(r => r.id === row.id ? { ...r, paid: newPaid, paid_at: newPaidAt } : r));
        const { error } = await supabase
            .from("issued_invoices")
            .update({ paid: newPaid, paid_at: newPaidAt })
            .eq("id", row.id);
        if (error) {
            // Revertir si falla
            setRows(rs => rs.map(r => r.id === row.id ? { ...r, paid: row.paid, paid_at: row.paid_at } : r));
            setMsg({ type: "error", text: `No se pudo actualizar el cobro: ${error.message}` });
        }
        setPayingId(null);
    };

    // Trae todos los UUID ya registrados (paginado) para deduplicar antes de insertar
    const fetchExistingUuids = async (): Promise<Set<string>> => {
        const set = new Set<string>();
        const PAGE = 1000;
        let from = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { data, error } = await supabase
                .from("issued_invoices")
                .select("uuid")
                .not("uuid", "is", null)
                .range(from, from + PAGE - 1);
            if (error || !data) break;
            for (const r of data as { uuid: string | null }[]) if (r.uuid) set.add(r.uuid);
            if (data.length < PAGE) break;
            from += PAGE;
        }
        return set;
    };

    const handleFiles = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        const xmlFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith(".xml"));
        if (xmlFiles.length === 0) {
            setMsg({ type: "error", text: "No se encontraron archivos .xml en la selección." });
            return;
        }

        setImporting(true);
        setReport(null);
        setMsg(null);
        setProgress({ done: 0, total: xmlFiles.length });

        let inserted = 0, duplicates = 0, invalid = 0, errors = 0, done = 0;
        const seen = new Set<string>();
        const existing = await fetchExistingUuids();

        const BATCH = 20;
        for (let i = 0; i < xmlFiles.length; i += BATCH) {
            const slice = xmlFiles.slice(i, i + BATCH);
            const batchRows: any[] = [];

            await Promise.all(slice.map(async (file) => {
                try {
                    const text = await file.text();
                    const cfdi = parseCFDI(text);
                    if (!cfdi.isCfdi) { invalid++; return; }

                    const uuid = cfdi.uuid || null;
                    if (uuid) {
                        if (existing.has(uuid) || seen.has(uuid)) { duplicates++; return; }
                        seen.add(uuid);
                    }

                    // Sube el XML a almacenamiento (ruta por UUID para evitar choques)
                    let xml_url: string | null = null;
                    const safeName = uuid
                        ? `${uuid}.xml`
                        : `nouuid_${Date.now()}_${Math.random().toString(36).slice(2)}.xml`;
                    const path = `${INVOICE_PREFIX}/${safeName}`;
                    const { error: upErr } = await supabase.storage
                        .from(BUCKET)
                        .upload(path, file, { upsert: true, contentType: "application/xml" });
                    if (!upErr) {
                        xml_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
                    }

                    batchRows.push({
                        uuid,
                        serie: cfdi.serie || null,
                        folio: cfdi.folio || null,
                        invoice_date: cfdi.fecha ? new Date(cfdi.fecha).toISOString() : null,
                        emisor_rfc: cfdi.emisor_rfc || null,
                        emisor_nombre: cfdi.emisor_nombre || null,
                        receptor_rfc: cfdi.receptor_rfc || null,
                        receptor_nombre: cfdi.receptor_nombre || null,
                        subtotal: cfdi.subtotal ?? null,
                        vat_total: cfdi.iva ?? null,
                        total: cfdi.total ?? null,
                        currency: cfdi.moneda || "MXN",
                        line_items: cfdi.conceptos || [],
                        xml_url,
                        file_name: file.name,
                        source: "upload",
                    });
                } catch {
                    errors++;
                }
            }));

            if (batchRows.length) {
                const { error } = await supabase.from("issued_invoices").insert(batchRows);
                if (error) {
                    errors += batchRows.length;
                } else {
                    inserted += batchRows.length;
                }
            }

            done += slice.length;
            setProgress({ done, total: xmlFiles.length });
        }

        setImporting(false);
        setProgress(null);
        setReport({ total: xmlFiles.length, inserted, duplicates, invalid, errors });
        setMsg({
            type: errors > 0 ? "error" : "success",
            text: `Importación terminada: ${inserted} nueva(s), ${duplicates} duplicada(s), ${invalid} no válida(s)${errors > 0 ? `, ${errors} con error` : ""}.`,
        });
        fetchInvoices();
    };

    // filtros
    const min = minValue.trim() === "" ? null : Number(minValue);
    const max = maxValue.trim() === "" ? null : Number(maxValue);

    const filteredRows = rows.filter((r) => {
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            const hay =
                (r.receptor_nombre || "").toLowerCase().includes(q) ||
                (r.receptor_rfc || "").toLowerCase().includes(q) ||
                (r.folio || "").toLowerCase().includes(q) ||
                (r.uuid || "").toLowerCase().includes(q);
            if (!hay) return false;
        }
        const total = Number(r.total) || 0;
        if (min != null && !isNaN(min) && total < min) return false;
        if (max != null && !isNaN(max) && total > max) return false;
        if (paidFilter === "paid" && !r.paid) return false;
        if (paidFilter === "unpaid" && r.paid) return false;
        return true;
    });

    const hasActiveFilters = search.trim() !== "" || minValue.trim() !== "" || maxValue.trim() !== "" || paidFilter !== "all";
    const clearFilters = () => { setSearch(""); setMinValue(""); setMaxValue(""); setPaidFilter("all"); };

    const sumFiltered = filteredRows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    const sumCobrado = filteredRows.filter(r => r.paid).reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    const sumPorCobrar = sumFiltered - sumCobrado;

    const PAID_FILTERS: { key: "all" | "paid" | "unpaid"; label: string }[] = [
        { key: "all", label: "Todas" },
        { key: "paid", label: "Cobradas" },
        { key: "unpaid", label: "Por cobrar" },
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Receipt className="w-8 h-8 text-teal-400" />
                                Facturas Emitidas
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">CFDI que tu negocio ha emitido a clientes. Sube tu carpeta de XML para importarlas.</p>
                        </div>
                    </div>
                    <button onClick={fetchInvoices} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-teal-400")} /> Refresh
                    </button>
                </header>

                {msg && (
                    <div className={cn(
                        "p-4 rounded-xl border flex items-center gap-3",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    )}>
                        {msg.type === "error" ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> : <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                        {msg.text}
                    </div>
                )}

                {/* Cargador masivo */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-6 backdrop-blur-sm">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                        <div className="flex items-start gap-3">
                            <div className="bg-teal-500/10 p-2.5 rounded-xl border border-teal-500/20">
                                <UploadCloud className="w-5 h-5 text-teal-400" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-white">Importar facturas (XML CFDI)</h3>
                                <p className="text-neutral-400 text-sm mt-0.5 max-w-xl">
                                    Selecciona la carpeta completa con tus XML o varios archivos a la vez. Leo el UUID, cliente, fecha, IVA y total de cada uno. No se duplican: si un CFDI ya existe, se omite automáticamente.
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center flex-shrink-0">
                            <button
                                onClick={() => folderRef.current?.click()}
                                disabled={importing}
                                className="inline-flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                <FolderUp className="w-4 h-4" /> Subir carpeta
                            </button>
                            <button
                                onClick={() => filesRef.current?.click()}
                                disabled={importing}
                                className="inline-flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all border border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                <FileCode className="w-4 h-4 text-teal-400" /> Subir archivos
                            </button>
                        </div>

                        {/* Inputs ocultos */}
                        <input
                            ref={folderRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
                            {...({ webkitdirectory: "", directory: "" } as any)}
                        />
                        <input
                            ref={filesRef}
                            type="file"
                            multiple
                            accept=".xml,application/xml,text/xml"
                            className="hidden"
                            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
                        />
                    </div>

                    {/* Progreso */}
                    {progress && (
                        <div className="mt-5">
                            <div className="flex items-center justify-between text-sm text-neutral-400 mb-2">
                                <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin text-teal-400" /> Procesando facturas…</span>
                                <span className="font-medium text-neutral-200">{progress.done} / {progress.total}</span>
                            </div>
                            <div className="h-2.5 bg-neutral-900/60 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300"
                                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Reporte */}
                    {report && !progress && (
                        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                                <p className="text-xs text-emerald-300/80 uppercase tracking-wide flex items-center gap-1"><FileCheck className="w-3.5 h-3.5" /> Nuevas</p>
                                <p className="text-2xl font-bold text-white mt-1">{report.inserted}</p>
                            </div>
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                                <p className="text-xs text-amber-300/80 uppercase tracking-wide">Duplicadas</p>
                                <p className="text-2xl font-bold text-white mt-1">{report.duplicates}</p>
                            </div>
                            <div className="bg-neutral-700/30 border border-neutral-600/30 rounded-xl p-3">
                                <p className="text-xs text-neutral-400 uppercase tracking-wide">No válidas</p>
                                <p className="text-2xl font-bold text-white mt-1">{report.invalid}</p>
                            </div>
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                                <p className="text-xs text-red-300/80 uppercase tracking-wide">Con error</p>
                                <p className="text-2xl font-bold text-white mt-1">{report.errors}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Filtros */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-5 backdrop-blur-sm">
                    <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                        <div className="flex items-center gap-2 text-neutral-400 text-sm font-medium flex-shrink-0">
                            <Filter className="w-4 h-4" /> Filtros
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 flex-1 flex-wrap">
                            <div className="relative flex-1 min-w-0 min-w-[240px]">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar por cliente, RFC, folio o UUID..."
                                    className="w-full bg-neutral-900/60 border border-neutral-700/50 rounded-xl pl-10 pr-9 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20"
                                />
                                {search && (
                                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white p-1 rounded-md hover:bg-neutral-700/50">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-neutral-500 text-sm">Valor</span>
                                <input type="number" inputMode="decimal" value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder="Mín"
                                    className="w-24 bg-neutral-900/60 border border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20" />
                                <span className="text-neutral-600">–</span>
                                <input type="number" inputMode="decimal" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} placeholder="Máx"
                                    className="w-24 bg-neutral-900/60 border border-neutral-700/50 rounded-xl px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20" />
                            </div>
                            <div className="flex items-center gap-1 bg-neutral-900/60 border border-neutral-700/50 rounded-xl p-1">
                                {PAID_FILTERS.map(f => (
                                    <button
                                        key={f.key}
                                        onClick={() => setPaidFilter(f.key)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                                            paidFilter === f.key
                                                ? "bg-teal-500/20 text-teal-300"
                                                : "text-neutral-400 hover:text-white"
                                        )}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                            {hasActiveFilters && (
                                <button onClick={clearFilters} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white bg-neutral-800/60 hover:bg-neutral-700/60 px-3 py-2.5 rounded-xl border border-neutral-700/50 whitespace-nowrap">
                                    <X className="w-3.5 h-3.5" /> Limpiar
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tabla */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 flex flex-wrap justify-between items-center gap-4 bg-neutral-800/20">
                        <h2 className="text-xl font-semibold text-white">
                            Facturas
                            <span className="ml-2 text-sm font-normal text-neutral-400">
                                {hasActiveFilters ? `${filteredRows.length} de ${rows.length}` : rows.length}
                            </span>
                        </h2>
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                            <span className="text-neutral-400">
                                {hasActiveFilters ? "Filtrado" : "Emitido"}: <span className="text-neutral-200 font-semibold">{fmtMoney(sumFiltered)}</span>
                            </span>
                            <span className="text-neutral-400">
                                Cobrado: <span className="text-emerald-300 font-semibold">{fmtMoney(sumCobrado)}</span>
                            </span>
                            <span className="text-neutral-400 inline-flex items-center gap-1">
                                <Wallet className="w-4 h-4 text-amber-400" /> Por cobrar: <span className="text-amber-300 font-semibold">{fmtMoney(sumPorCobrar)}</span>
                            </span>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">Serie-Folio</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">RFC</th>
                                    <th className="px-6 py-4">Fecha</th>
                                    <th className="px-6 py-4">Subtotal</th>
                                    <th className="px-6 py-4">IVA</th>
                                    <th className="px-6 py-4">Total</th>
                                    <th className="px-6 py-4 text-center">Pagado</th>
                                    <th className="px-6 py-4">UUID</th>
                                    <th className="px-6 py-4 text-right">XML</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={10} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-teal-500" />Cargando...</td></tr>
                                ) : filteredRows.length === 0 ? (
                                    <tr><td colSpan={10} className="px-6 py-12 text-center text-neutral-400">
                                        <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700"><Receipt className="w-8 h-8 text-neutral-500" /></div>
                                        {hasActiveFilters ? (
                                            <>
                                                <p className="text-lg text-neutral-300 font-medium">Sin resultados para estos filtros</p>
                                                <p className="text-sm mt-1">Ajusta la búsqueda o limpia los filtros.</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-lg text-neutral-300 font-medium">Aún no hay facturas emitidas</p>
                                                <p className="text-sm mt-1">Usa "Subir carpeta" para importar tus XML.</p>
                                            </>
                                        )}
                                    </td></tr>
                                ) : (
                                    filteredRows.map((r) => (
                                        <tr key={r.id} className="hover:bg-neutral-800/80 transition-colors">
                                            <td className="px-6 py-4 font-mono text-xs text-teal-300">{[r.serie, r.folio].filter(Boolean).join("-") || "—"}</td>
                                            <td className="px-6 py-4 font-medium text-neutral-200 max-w-[240px] truncate">{r.receptor_nombre || "—"}</td>
                                            <td className="px-6 py-4 font-mono text-xs text-neutral-400">{r.receptor_rfc || "—"}</td>
                                            <td className="px-6 py-4 text-neutral-400">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : "—"}</td>
                                            <td className="px-6 py-4 text-neutral-400">{fmtMoney(r.subtotal)}</td>
                                            <td className="px-6 py-4 text-neutral-400">{fmtMoney(r.vat_total)}</td>
                                            <td className="px-6 py-4 font-medium text-emerald-400">{fmtMoney(r.total)}</td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => togglePaid(r)}
                                                    disabled={payingId === r.id}
                                                    title={r.paid ? "Marcada como cobrada — clic para revertir" : "Marcar como cobrada"}
                                                    className={cn(
                                                        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 disabled:cursor-wait",
                                                        r.paid
                                                            ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"
                                                            : "bg-neutral-800/60 border-neutral-600/40 text-neutral-400 hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-300"
                                                    )}
                                                >
                                                    {payingId === r.id ? (
                                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <span className={cn(
                                                            "w-4 h-4 rounded flex items-center justify-center border",
                                                            r.paid ? "bg-emerald-500 border-emerald-500" : "border-neutral-500"
                                                        )}>
                                                            {r.paid && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                                        </span>
                                                    )}
                                                    {r.paid ? "Cobrada" : "Por cobrar"}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 font-mono text-[11px] text-neutral-500 max-w-[160px] truncate" title={r.uuid || ""}>{r.uuid || "—"}</td>
                                            <td className="px-6 py-4 text-right">
                                                {r.xml_url ? (
                                                    <a href={r.xml_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20"><FileCode className="w-3.5 h-3.5" /> XML</a>
                                                ) : <span className="text-neutral-600 text-xs">—</span>}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
