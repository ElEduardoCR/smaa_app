"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Clock, Upload, RefreshCw, FileText, AlertTriangle, CheckCircle2, Eye, Trash2, Calendar, Users
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmt = (n: number | null | undefined) => (Number(n) || 0).toFixed(2);

type Upload = {
    id: string; file_name: string; file_url: string;
    period_start: string; period_end: string; format: string | null;
    status: string; rows_total: number; rows_parsed: number; rows_unmatched: number;
    error_message: string | null; uploaded_at: string; parsed_at: string | null;
};

// Parser CSV simple pero tolerante. Detecta columnas por nombres comunes.
function parseCSV(text: string): { rows: any[]; errors: string[] } {
    const errors: string[] = [];
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { rows: [], errors: ["El archivo está vacío o solo tiene encabezados."] };
    const split = (line: string) => {
        // Soporta CSV con comas o punto y coma
        const sep = line.includes(";") && !line.includes(",") ? ";" : ",";
        return line.split(sep).map(c => c.trim().replace(/^"|"$/g, ""));
    };
    const headers = split(lines[0]).map(h => h.toLowerCase());
    const idxOf = (...candidates: string[]) => {
        for (const c of candidates) {
            const i = headers.findIndex(h => h === c || h.includes(c));
            if (i !== -1) return i;
        }
        return -1;
    };
    const idCol = idxOf("id_empleado", "employee_id", "no_empleado", "codigo", "code", "employee", "empleado");
    const dateCol = idxOf("fecha", "date", "dia");
    const inCol = idxOf("entrada", "check_in", "checkin", "in", "hora_entrada", "ingreso");
    const outCol = idxOf("salida", "check_out", "checkout", "out", "hora_salida", "egreso");
    const hoursCol = idxOf("horas", "hours", "horas_trabajadas", "worked_hours");
    // Modo "long": cada fila es un solo evento (entrada o salida)
    const timeCol = idxOf("hora", "time", "timestamp");
    const typeCol = idxOf("tipo", "type", "io", "in_out");
    if (idCol === -1 || dateCol === -1) {
        return { rows: [], errors: ["Faltan columnas obligatorias. Se requiere al menos: id_empleado y fecha."] };
    }
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = split(lines[i]);
        if (cols.length < 2) continue;
        rows.push({
            employee_code: cols[idCol] || "",
            date: cols[dateCol] || "",
            check_in: inCol !== -1 ? cols[inCol] : "",
            check_out: outCol !== -1 ? cols[outCol] : "",
            hours: hoursCol !== -1 ? cols[hoursCol] : "",
            time: timeCol !== -1 ? cols[timeCol] : "",
            type: typeCol !== -1 ? cols[typeCol] : "",
        });
    }
    return { rows, errors };
}

function parseDate(s: string): Date | null {
    if (!s) return null;
    // Try ISO, dd/mm/yyyy, yyyy-mm-dd
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00`);
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashMatch) {
        let [_, d, m, y] = slashMatch;
        if (y.length === 2) y = "20" + y;
        return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00`);
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
}

function parseTime(s: string): { h: number; m: number } | null {
    if (!s) return null;
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return { h: parseInt(m[1]), m: parseInt(m[2]) };
    return null;
}

export default function ChecadorPage() {
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [activeUpload, setActiveUpload] = useState<Upload | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
    const [periodStart, setPeriodStart] = useState(new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));
    const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
    const [preview, setPreview] = useState<{ rows: any[]; errors: string[]; entries: any[]; unmatched: number } | null>(null);
    const [entries, setEntries] = useState<any[]>([]);

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("time_clock_uploads")
                .select("*")
                .order("uploaded_at", { ascending: false })
                .limit(50);
            if (error) throw error;
            setUploads(data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    useEffect(() => {
        if (activeUpload) loadEntries(activeUpload.id);
    }, [activeUpload]);

    const loadEntries = async (uploadId: string) => {
        const { data } = await supabase
            .from("time_clock_entries")
            .select("*, employee:employees(id, full_name, code, payment_type, hourly_rate, weekly_hours, overtime_factor)")
            .eq("upload_id", uploadId)
            .order("work_date", { ascending: true });
        setEntries(data || []);
    };

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setMsg(null);
        setPreview(null);
        setBusy(true);
        try {
            let text = "";
            if (f.name.toLowerCase().endsWith(".csv") || f.name.toLowerCase().endsWith(".txt")) {
                text = await f.text();
            } else if (f.name.toLowerCase().endsWith(".xlsx") || f.name.toLowerCase().endsWith(".xls")) {
                // Para XLSX mejor pedirle al usuario que exporte a CSV; pero podemos intentar:
                setMsg({ type: "info", text: "Por ahora el parser soporta CSV/TXT. Exporta tu XLSX como CSV e intenta de nuevo." });
                setBusy(false);
                return;
            } else {
                setMsg({ type: "error", text: "Formato no soportado. Usa CSV o TXT." });
                setBusy(false);
                return;
            }
            const { rows, errors } = parseCSV(text);
            if (rows.length === 0) {
                setMsg({ type: "error", text: errors.join(" ") || "Archivo sin filas válidas." });
                setBusy(false);
                return;
            }
            // Match employees
            const codes = Array.from(new Set(rows.map(r => r.employee_code).filter(Boolean)));
            const { data: emps } = await supabase.from("payroll_employees").select("id, code, full_name, payment_type, hourly_rate, weekly_hours, overtime_factor").in("code", codes as string[]);
            const empMap: Record<string, any> = {};
            (emps || []).forEach((e: any) => { empMap[e.code] = e; });

            // Group by employee+date
            type Key = string;
            const grouped: Record<Key, { employee_id: string | null; employee_code: string; date: string; check_in: string; check_out: string; hours: number }> = {};
            let unmatched = 0;
            for (const r of rows) {
                if (!r.employee_code || !r.date) { unmatched++; continue; }
                const emp = empMap[r.employee_code];
                if (!emp) unmatched++;
                // Modo "wide": in/out por fila
                if (r.check_in || r.check_out) {
                    const key = `${r.employee_code}|${r.date}`;
                    if (!grouped[key]) {
                        grouped[key] = { employee_id: emp?.id || null, employee_code: r.employee_code, date: r.date, check_in: r.check_in, check_out: r.check_out, hours: 0 };
                    } else {
                        if (!grouped[key].check_in && r.check_in) grouped[key].check_in = r.check_in;
                        if (!grouped[key].check_out && r.check_out) grouped[key].check_out = r.check_out;
                    }
                } else if (r.hours) {
                    const key = `${r.employee_code}|${r.date}`;
                    grouped[key] = { employee_id: emp?.id || null, employee_code: r.employee_code, date: r.date, check_in: "", check_out: "", hours: parseFloat(r.hours) || 0 };
                } else if (r.time && r.type) {
                    // Modo "long": cada fila es un evento entrada o salida
                    const t = r.type.toLowerCase();
                    const key = `${r.employee_code}|${r.date}`;
                    if (!grouped[key]) grouped[key] = { employee_id: emp?.id || null, employee_code: r.employee_code, date: r.date, check_in: "", check_out: "", hours: 0 };
                    if (t.includes("in") || t.includes("entrada") || t === "i" || t === "1") {
                        grouped[key].check_in = r.time;
                    } else if (t.includes("out") || t.includes("salida") || t === "o" || t === "2" || t === "s") {
                        grouped[key].check_out = r.time;
                    }
                }
            }

            // Calcular horas
            const computed: any[] = [];
            for (const g of Object.values(grouped)) {
                let hours = g.hours;
                let overtime = 0;
                if (!hours && g.check_in && g.check_out) {
                    const ci = parseTime(g.check_in);
                    const co = parseTime(g.check_out);
                    if (ci && co) {
                        let mins = (co.h * 60 + co.m) - (ci.h * 60 + ci.m);
                        if (mins < 0) mins += 24 * 60; // turno nocturno
                        hours = mins / 60;
                    }
                }
                // Si tenemos el empleado, calcular overtime si supera weekly_hours/5 (jornada diaria base)
                if (g.employee_id) {
                    const emp = empMap[g.employee_code];
                    if (emp) {
                        const dailyBase = Number(emp.weekly_hours || 48) / 5;
                        if (hours > dailyBase) {
                            overtime = hours - dailyBase;
                            hours = dailyBase;
                        }
                    }
                }
                computed.push({ ...g, hours_worked: hours, overtime_hours: overtime });
            }

            setPreview({ rows, errors, entries: computed, unmatched });
            setMsg({ type: "success", text: `Detecté ${rows.length} filas · ${computed.length} jornadas · ${unmatched} sin matchear.` });
        } catch (e: any) {
            setMsg({ type: "error", text: e?.message || "Error al leer el archivo." });
        } finally {
            setBusy(false);
            if ((e.target as HTMLInputElement)) (e.target as HTMLInputElement).value = "";
        }
    };

    const confirmUpload = async () => {
        if (!preview) return;
        setBusy(true);
        try {
            // Subir el archivo crudo a Supabase storage
            const fileInput = document.getElementById("checador-file") as HTMLInputElement;
            const f = fileInput?.files?.[0];
            let fileUrl = "";
            if (f) {
                const path = `checador/${Date.now()}_${f.name}`;
                const { error: upErr } = await supabase.storage.from("finance_files").upload(path, f, { cacheControl: "3600", upsert: false, contentType: f.type });
                if (upErr) throw upErr;
                const { data } = supabase.storage.from("finance_files").getPublicUrl(path);
                fileUrl = data.publicUrl;
            }

            const { data: up, error: upErr } = await supabase.from("time_clock_uploads").insert([{
                file_name: f?.name || "archivo.csv",
                file_url: fileUrl,
                period_start: periodStart,
                period_end: periodEnd,
                format: f?.name.split(".").pop() || "csv",
                status: "parsed",
                rows_total: preview.rows.length,
                rows_parsed: preview.entries.length,
                rows_unmatched: preview.unmatched,
                parsed_at: new Date().toISOString(),
            }]).select().single();
            if (upErr) throw upErr;

            // Insertar entradas
            const rowsToInsert = preview.entries.map(e => ({
                upload_id: up.id,
                employee_id: e.employee_id,
                employee_code_raw: e.employee_code,
                work_date: parseDate(e.date)?.toISOString().slice(0, 10) || e.date,
                check_in: e.check_in ? new Date(`${parseDate(e.date)?.toISOString().slice(0, 10)}T${e.check_in}`).toISOString() : null,
                check_out: e.check_out ? new Date(`${parseDate(e.date)?.toISOString().slice(0, 10)}T${e.check_out}`).toISOString() : null,
                hours_worked: e.hours_worked,
                overtime_hours: e.overtime_hours,
            }));
            const { error: eErr } = await supabase.from("time_clock_entries").insert(rowsToInsert);
            if (eErr) throw eErr;

            setMsg({ type: "success", text: `Guardado: ${rowsToInsert.length} entradas de checador.` });
            setPreview(null);
            await load();
            if (up) {
                setActiveUpload(up);
            }
        } catch (e: any) {
            setMsg({ type: "error", text: e?.message || "Error al guardar." });
        } finally {
            setBusy(false);
        }
    };

    const deleteUpload = async (u: Upload) => {
        if (!confirm(`¿Eliminar la carga "${u.file_name}" y todas sus entradas?`)) return;
        await supabase.from("time_clock_uploads").delete().eq("id", u.id);
        if (activeUpload?.id === u.id) setActiveUpload(null);
        load();
    };

    // Aggregate entries by employee
    const summary = entries.reduce((acc: any, e: any) => {
        const id = e.employee_id || `unmatched-${e.employee_code_raw}`;
        if (!acc[id]) acc[id] = { employee: e.employee, code: e.employee_code_raw, days: 0, hours: 0, overtime: 0 };
        acc[id].days += 1;
        acc[id].hours += Number(e.hours_worked) || 0;
        acc[id].overtime += Number(e.overtime_hours) || 0;
        return acc;
    }, {});

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Clock className="w-8 h-8 text-cyan-400" />
                                Checador
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Sube el archivo del reloj checador y calcula las horas trabajadas y extras.</p>
                        </div>
                    </div>
                    <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-cyan-400")} /> Actualizar
                    </button>
                </header>

                {msg && (
                    <div className={cn("p-3 rounded-xl border flex items-center gap-2",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        msg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
                        "bg-sky-500/10 border-sky-500/30 text-sky-300"
                    )}>
                        {msg.type === "error" ? <AlertTriangle className="w-4 h-4" /> : msg.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <FileText className="w-4 h-4" />} {msg.text}
                    </div>
                )}

                {/* Upload section */}
                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-3">
                    <h2 className="text-lg font-semibold text-white">1) Subir archivo del checador</h2>
                    <p className="text-xs text-neutral-400">
                        Formato: CSV o TXT con columnas: <code className="text-emerald-300">id_empleado</code>, <code className="text-emerald-300">fecha</code>, <code className="text-emerald-300">entrada</code>, <code className="text-emerald-300">salida</code>.
                        O bien columnas <code className="text-amber-300">id_empleado, fecha, hora, tipo</code> (entrada/salida por fila).
                        También se acepta una columna directa <code className="text-emerald-300">horas</code>.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400">Inicio del periodo</label>
                            <input value={periodStart} onChange={e => setPeriodStart(e.target.value)} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Fin del periodo</label>
                            <input value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Archivo</label>
                            <input id="checador-file" type="file" accept=".csv,.txt" onChange={handleFile} disabled={busy} className="block w-full mt-1 text-sm text-neutral-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-cyan-500/20 file:text-cyan-300 file:font-semibold file:cursor-pointer hover:file:bg-cyan-500/30" />
                        </div>
                    </div>

                    {preview && (
                        <div className="bg-neutral-900/40 border border-neutral-700/50 rounded-xl p-3 mt-3">
                            <p className="text-sm text-white font-medium mb-2">Vista previa (antes de guardar):</p>
                            <p className="text-xs text-neutral-400 mb-2">
                                {preview.entries.length} jornadas detectadas · {preview.unmatched} empleados no matcheados · {preview.errors.length > 0 ? `${preview.errors.length} advertencias` : "sin advertencias"}
                            </p>
                            <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-700/50">
                                <table className="w-full text-xs">
                                    <thead className="bg-neutral-800 text-neutral-400">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Código</th>
                                            <th className="px-3 py-2 text-left">Empleado</th>
                                            <th className="px-3 py-2 text-left">Fecha</th>
                                            <th className="px-3 py-2 text-left">Entrada</th>
                                            <th className="px-3 py-2 text-left">Salida</th>
                                            <th className="px-3 py-2 text-right">Horas</th>
                                            <th className="px-3 py-2 text-right">Extras</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-700/30">
                                        {preview.entries.slice(0, 100).map((e, i) => (
                                            <tr key={i} className={cn(e.employee_id ? "" : "bg-red-500/5 text-red-300")}>
                                                <td className="px-3 py-1.5 font-mono">{e.employee_code}</td>
                                                <td className="px-3 py-1.5">{e.employee_id ? "✓ match" : "✗ no encontrado"}</td>
                                                <td className="px-3 py-1.5">{e.date}</td>
                                                <td className="px-3 py-1.5 font-mono">{e.check_in || "—"}</td>
                                                <td className="px-3 py-1.5 font-mono">{e.check_out || "—"}</td>
                                                <td className="px-3 py-1.5 text-right font-mono">{fmt(e.hours_worked)}</td>
                                                <td className="px-3 py-1.5 text-right font-mono text-amber-300">{fmt(e.overtime_hours)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex justify-end mt-3">
                                <button onClick={confirmUpload} disabled={busy} className="bg-cyan-500 hover:bg-cyan-600 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                                    {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                    Confirmar y guardar
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Uploads list */}
                <div className="bg-neutral-800/40 p-5 rounded-3xl border border-neutral-700/50">
                    <h2 className="text-lg font-semibold text-white mb-3">2) Cargas recientes</h2>
                    {loading ? <p className="text-sm text-neutral-400 text-center py-4">Cargando…</p> : uploads.length === 0 ? (
                        <p className="text-sm text-neutral-500 text-center py-6">Aún no hay cargas. Sube la primera arriba.</p>
                    ) : (
                        <ul className="divide-y divide-neutral-700/50">
                            {uploads.map(u => (
                                <li key={u.id} className="py-3 flex items-center gap-3">
                                    <FileText className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white truncate">{u.file_name}</p>
                                        <p className="text-[11px] text-neutral-500">
                                            {new Date(u.period_start).toLocaleDateString()} → {new Date(u.period_end).toLocaleDateString()} ·
                                            {" "}{u.rows_parsed} jornadas · {u.rows_unmatched} sin matchear
                                        </p>
                                    </div>
                                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase",
                                        u.status === "parsed" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                                        u.status === "pending" ? "bg-amber-500/10 text-amber-300 border-amber-500/30" :
                                        "bg-red-500/10 text-red-300 border-red-500/30"
                                    )}>
                                        {u.status}
                                    </span>
                                    <button onClick={() => setActiveUpload(u)} className="p-1.5 text-neutral-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition-colors" title="Ver detalle">
                                        <Eye className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => deleteUpload(u)} className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors" title="Eliminar">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Detail of selected upload */}
                {activeUpload && (
                    <div className="bg-neutral-800/40 p-5 rounded-3xl border border-neutral-700/50 space-y-3">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-cyan-400" /> {activeUpload.file_name}
                        </h3>
                        <p className="text-xs text-neutral-400">
                            Periodo: {new Date(activeUpload.period_start).toLocaleDateString()} → {new Date(activeUpload.period_end).toLocaleDateString()} · {entries.length} entradas
                        </p>

                        {/* Summary by employee */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {Object.values(summary).map((s: any) => (
                                <div key={s.code} className="bg-neutral-900/40 border border-neutral-700/40 rounded-xl p-3 flex items-center gap-3">
                                    <Users className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-white truncate">{s.employee?.full_name || s.code}</p>
                                        <p className="text-[10px] text-neutral-500">{s.days} días · {fmt(s.hours)} h normales · <span className="text-amber-300">{fmt(s.overtime)} h extras</span></p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Detail table */}
                        {entries.length > 0 && (
                            <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-700/50">
                                <table className="w-full text-xs">
                                    <thead className="bg-neutral-800 text-neutral-400 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Empleado</th>
                                            <th className="px-3 py-2 text-left">Fecha</th>
                                            <th className="px-3 py-2 text-left">Entrada</th>
                                            <th className="px-3 py-2 text-left">Salida</th>
                                            <th className="px-3 py-2 text-right">Horas</th>
                                            <th className="px-3 py-2 text-right">Extras</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-neutral-700/30">
                                        {entries.map((e: any) => (
                                            <tr key={e.id}>
                                                <td className="px-3 py-1.5">{e.employee?.full_name || e.employee_code_raw}</td>
                                                <td className="px-3 py-1.5">{e.work_date}</td>
                                                <td className="px-3 py-1.5 font-mono">{e.check_in ? new Date(e.check_in).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                                                <td className="px-3 py-1.5 font-mono">{e.check_out ? new Date(e.check_out).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                                                <td className="px-3 py-1.5 text-right font-mono">{fmt(e.hours_worked)}</td>
                                                <td className="px-3 py-1.5 text-right font-mono text-amber-300">{fmt(e.overtime_hours)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
