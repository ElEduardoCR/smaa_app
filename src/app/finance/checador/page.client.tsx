"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    AlertTriangle,
    ArrowLeft,
    Bot,
    CalendarDays,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock3,
    FileSpreadsheet,
    RefreshCw,
    UploadCloud,
    Users,
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Employee = {
    employeeId: string;
    code: string;
    fullName: string;
};

type DailyRecord = {
    id: string;
    employeeId: string;
    employeeCode: string;
    workDate: string;
    checkIn: string | null;
    checkOut: string | null;
    workedMinutes: number;
};

type Upload = {
    id: string;
    file_name: string;
    period_start: string;
    period_end: string;
    format: string;
    status: string;
    rows_total: number;
    rows_parsed: number;
    rows_unmatched: number;
    rows_inserted: number;
    rows_updated: number;
    rows_unchanged: number;
    rows_conflicted: number;
    uploaded_at: string;
    interpreter: string;
};

type WeeklyPayload = {
    weekStart: string;
    weekEnd: string;
    employees: Employee[];
    records: DailyRecord[];
    uploads: Upload[];
    latestRecordedDate: string | null;
    ai: {
        provider: "deepseek" | "deterministic";
        configured: boolean;
        model: string | null;
        thinking: boolean;
        reasoningEffort: "high" | null;
    };
};

type PreviewRecord = {
    employeeCode: string;
    employeeName: string | null;
    workDate: string;
    checkIn: string | null;
    checkOut: string | null;
    workedMinutes: number;
    action: "insert" | "complete" | "unchanged" | "conflict" | "unmatched";
};

type Preview = {
    fileName: string;
    rowsTotal: number;
    rowsDetected: number;
    rowsReady: number;
    unmatchedCount: number;
    unmatchedCodes: string[];
    conflictCount: number;
    warnings: string[];
    interpreter: string;
    sheetRoles: Array<{
        sheetIndex: number;
        sheetName: string;
        role: "attendance_source" | "summary" | "schedule" | "shift_definition" | "employee_detail" | "irrelevant";
    }>;
    periodStart: string;
    periodEnd: string;
    records: PreviewRecord[];
};

type Message = { type: "error" | "success" | "info"; text: string };

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function addDays(date: string, days: number): string {
    const value = new Date(`${date}T12:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function currentWeekStart(): string {
    const value = new Date();
    const day = value.getDay();
    value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const date = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${date}`;
}

function dateLabel(date: string, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat("es-MX", options || { day: "numeric", month: "short" })
        .format(new Date(`${date}T12:00:00.000Z`));
}

function timeLabel(value: string | null): string {
    if (!value) return "—";
    return value.slice(0, 5);
}

function hoursLabel(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}:${String(remainder).padStart(2, "0")}`;
}

const actionLabel: Record<PreviewRecord["action"], string> = {
    insert: "Nuevo",
    complete: "Completa pendiente",
    unchanged: "Ya registrado",
    conflict: "Revisar conflicto",
    unmatched: "Empleado no encontrado",
};

const sheetRoleLabel: Record<Preview["sheetRoles"][number]["role"], string> = {
    attendance_source: "Fuente de marcajes",
    summary: "Resumen",
    schedule: "Calendario",
    shift_definition: "Definición de turno",
    employee_detail: "Detalle duplicado",
    irrelevant: "No utilizada",
};

function errorMessage(status: number, payload: { error?: string; message?: string }): string {
    if (payload.message) return payload.message;
    if (status === 401) return "Tu sesión terminó. Vuelve a iniciar sesión.";
    if (status === 403) return "No tienes permiso para importar el checador.";
    if (status === 413) return "El archivo supera el límite de 5 MB.";
    if (status === 415) return "Usa un archivo Excel .xls o .xlsx, CSV o TXT.";
    if (payload.error === "no_matching_records") return "Ningún código del archivo coincide con un empleado activo.";
    return "No se pudo procesar el archivo. Revisa su formato e intenta nuevamente.";
}

export default function ChecadorPage() {
    const [weekStart, setWeekStart] = useState(currentWeekStart);
    const [weekly, setWeekly] = useState<WeeklyPayload | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<Message | null>(null);

    const loadWeek = useCallback(async (targetWeek: string) => {
        setLoading(true);
        try {
            const response = await fetch(`/api/time-clock/imports?week=${encodeURIComponent(targetWeek)}`, {
                cache: "no-store",
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(errorMessage(response.status, payload));
            setWeekly(payload as WeeklyPayload);
        } catch (error) {
            setMessage({ type: "error", text: error instanceof Error ? error.message : "No se pudo cargar la semana." });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadWeek(weekStart);
    }, [loadWeek, weekStart]);

    const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
    const recordByEmployeeDay = useMemo(
        () => new Map((weekly?.records || []).map((record) => [`${record.employeeId}|${record.workDate}`, record])),
        [weekly?.records],
    );

    const totals = useMemo(() => {
        const records = weekly?.records || [];
        return {
            complete: records.filter((record) => record.checkIn && record.checkOut).length,
            pending: records.filter((record) => !record.checkIn || !record.checkOut).length,
            minutes: records.reduce((sum, record) => sum + record.workedMinutes, 0),
        };
    }, [weekly?.records]);

    const sendFile = async (mode: "preview" | "commit") => {
        if (!selectedFile) return;
        setBusy(true);
        setMessage(null);
        try {
            const body = new FormData();
            body.set("mode", mode);
            body.set("file", selectedFile);
            const response = await fetch("/api/time-clock/imports", { method: "POST", body });
            const payload = await response.json();
            if (!response.ok) throw new Error(errorMessage(response.status, payload));

            if (mode === "preview") {
                setPreview(payload as Preview);
                const ready = Number(payload.rowsReady || 0);
                setMessage({
                    type: ready > 0 ? "success" : "info",
                    text: `Vista previa lista: ${payload.rowsDetected} jornadas detectadas, ${ready} listas para guardar.`,
                });
                return;
            }

            const result = payload.result || {};
            const text = result.already_imported
                ? "Este mismo archivo ya se había procesado; no se duplicó ningún registro."
                : `Carga guardada: ${result.inserted || 0} jornadas nuevas y ${result.updated || 0} salidas/entradas pendientes completadas.`;
            setMessage({ type: "success", text });
            setPreview(null);
            setSelectedFile(null);
            const input = document.getElementById("time-clock-file") as HTMLInputElement | null;
            if (input) input.value = "";
            await loadWeek(weekStart);
        } catch (error) {
            setMessage({ type: "error", text: error instanceof Error ? error.message : "No se pudo procesar el archivo." });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#080b10] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1500px] mx-auto space-y-6">
                <header className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-neutral-900 to-cyan-950/40 p-6 rounded-3xl border border-cyan-500/15 shadow-2xl shadow-black/20">
                    <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
                    <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
                        <div className="flex items-center gap-4">
                            <Link href="/finance" className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-neutral-400 hover:text-white border border-white/10 transition-colors">
                                <ArrowLeft className="w-5 h-5" />
                            </Link>
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-400/20">
                                    <Clock3 className="w-7 h-7 text-cyan-300" />
                                </div>
                                <div>
                                    <h1 className="text-2xl sm:text-3xl font-bold text-white">Checador semanal</h1>
                                    <p className="text-neutral-400 text-sm mt-1">Entradas, salidas y horas acumuladas desde archivos del reloj.</p>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-neutral-400 bg-black/20 border border-white/10 rounded-xl px-3 py-2">
                            <span className="h-2 w-2 rounded-full bg-neutral-500" />
                            Asistencia automática oculta
                        </div>
                    </div>
                </header>

                {message && (
                    <div className={cn(
                        "p-3.5 rounded-xl border flex items-start gap-2.5 text-sm",
                        message.type === "error" && "bg-red-500/10 border-red-500/30 text-red-200",
                        message.type === "success" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
                        message.type === "info" && "bg-sky-500/10 border-sky-500/30 text-sky-200",
                    )}>
                        {message.type === "error" ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
                        {message.text}
                    </div>
                )}

                <section className="bg-neutral-900/70 rounded-3xl border border-white/10 overflow-hidden">
                    <div className="p-5 sm:p-6 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-cyan-400 font-semibold">Registro por semana</p>
                            <h2 className="text-xl font-semibold text-white mt-1">
                                {dateLabel(weekStart, { day: "numeric", month: "long" })} – {dateLabel(addDays(weekStart, 6), { day: "numeric", month: "long", year: "numeric" })}
                            </h2>
                            <p className="text-xs text-neutral-500 mt-1">
                                Último día con información: {weekly?.latestRecordedDate ? dateLabel(weekly.latestRecordedDate, { day: "numeric", month: "long", year: "numeric" }) : "sin cargas"}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300" aria-label="Semana anterior">
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button onClick={() => setWeekStart(currentWeekStart())} className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-neutral-300">Esta semana</button>
                            <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300" aria-label="Semana siguiente">
                                <ChevronRight className="w-5 h-5" />
                            </button>
                            <button onClick={() => void loadWeek(weekStart)} disabled={loading} className="p-2.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 disabled:opacity-50" aria-label="Actualizar">
                                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-cyan-400")} />
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 border-b border-white/10">
                        <Metric icon={<Users className="w-4 h-4" />} label="Empleados" value={String(weekly?.employees.length || 0)} />
                        <Metric icon={<CheckCircle2 className="w-4 h-4" />} label="Jornadas completas" value={String(totals.complete)} tone="emerald" />
                        <Metric icon={<AlertTriangle className="w-4 h-4" />} label="Pendientes" value={String(totals.pending)} tone={totals.pending > 0 ? "amber" : "neutral"} />
                        <Metric icon={<Clock3 className="w-4 h-4" />} label="Horas registradas" value={hoursLabel(totals.minutes)} tone="cyan" />
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1120px] text-xs">
                            <thead>
                                <tr className="bg-black/20 text-neutral-400">
                                    <th className="sticky left-0 z-20 bg-[#101318] px-4 py-3 text-left min-w-52">Empleado</th>
                                    {days.map((day, index) => (
                                        <th key={day} className="px-3 py-3 text-left min-w-32">
                                            <span className="text-neutral-300">{DAY_NAMES[index]}</span>
                                            <span className="block text-[10px] text-neutral-600 mt-0.5">{dateLabel(day)}</span>
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-right min-w-24">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.06]">
                                {loading ? (
                                    <tr><td colSpan={9} className="px-4 py-14 text-center text-neutral-500">Cargando semana…</td></tr>
                                ) : (weekly?.employees.length || 0) === 0 ? (
                                    <tr><td colSpan={9} className="px-4 py-14 text-center text-neutral-500">No hay empleados activos registrados.</td></tr>
                                ) : weekly?.employees.map((employee) => {
                                    const employeeRecords = days.map((day) => recordByEmployeeDay.get(`${employee.employeeId}|${day}`));
                                    const employeeMinutes = employeeRecords.reduce((sum, record) => sum + (record?.workedMinutes || 0), 0);
                                    return (
                                        <tr key={employee.employeeId} className="hover:bg-white/[0.025]">
                                            <td className="sticky left-0 z-10 bg-[#101318] px-4 py-3 border-r border-white/[0.05]">
                                                <p className="font-medium text-white truncate max-w-44">{employee.fullName}</p>
                                                <p className="font-mono text-[10px] text-cyan-400 mt-0.5">{employee.code}</p>
                                            </td>
                                            {employeeRecords.map((record, index) => (
                                                <td key={days[index]} className="px-3 py-3 align-top">
                                                    {!record ? <span className="text-neutral-700">—</span> : (
                                                        <div className={cn(
                                                            "rounded-lg px-2.5 py-2 border",
                                                            record.checkIn && record.checkOut
                                                                ? "bg-emerald-500/[0.06] border-emerald-500/15"
                                                                : "bg-amber-500/[0.07] border-amber-500/20",
                                                        )}>
                                                            <p className="font-mono text-neutral-200 whitespace-nowrap">{timeLabel(record.checkIn)} <span className="text-neutral-600">→</span> {timeLabel(record.checkOut)}</p>
                                                            <p className={cn("text-[10px] mt-1", record.checkIn && record.checkOut ? "text-emerald-400" : "text-amber-300")}>
                                                                {record.checkIn && record.checkOut ? `${hoursLabel(record.workedMinutes)} h` : "Pendiente"}
                                                            </p>
                                                        </div>
                                                    )}
                                                </td>
                                            ))}
                                            <td className="px-4 py-3 text-right font-mono font-semibold text-cyan-300">{hoursLabel(employeeMinutes)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[1.45fr_0.75fr] gap-6">
                    <div className="bg-neutral-900/70 p-5 sm:p-6 rounded-3xl border border-white/10 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2 text-cyan-300">
                                    <UploadCloud className="w-5 h-5" />
                                    <h2 className="text-lg font-semibold text-white">Subir archivo del checador</h2>
                                </div>
                                <p className="text-sm text-neutral-400 mt-2 max-w-2xl">La interpretación reconoce empleado, fecha, entrada y salida. El ERP calcula las horas y completa pendientes de cargas anteriores sin duplicar días.</p>
                            </div>
                            <span className={cn(
                                "shrink-0 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border",
                                weekly?.ai.configured ? "bg-violet-500/10 border-violet-400/20 text-violet-300" : "bg-neutral-500/10 border-neutral-500/20 text-neutral-400",
                            )}>{weekly?.ai.configured ? "V4 Pro · Thinking alto" : "IA pendiente"}</span>
                        </div>

                        <label className={cn(
                            "block rounded-2xl border border-dashed p-7 text-center transition-colors cursor-pointer",
                            selectedFile ? "border-cyan-400/40 bg-cyan-500/[0.06]" : "border-neutral-700 hover:border-cyan-500/40 hover:bg-white/[0.02]",
                        )}>
                            <FileSpreadsheet className={cn("w-10 h-10 mx-auto", selectedFile ? "text-cyan-300" : "text-neutral-600")} />
                            <p className="text-sm text-white mt-3">{selectedFile?.name || "Selecciona un Excel .xls o .xlsx"}</p>
                            <p className="text-xs text-neutral-500 mt-1">También conserva compatibilidad con CSV/TXT · máximo 5 MB</p>
                            <input
                                id="time-clock-file"
                                type="file"
                                accept=".xls,.xlsx,.csv,.txt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                                className="sr-only"
                                disabled={busy}
                                onChange={(event) => {
                                    setSelectedFile(event.target.files?.[0] || null);
                                    setPreview(null);
                                    setMessage(null);
                                }}
                            />
                        </label>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-2 text-xs text-neutral-500 max-w-xl">
                                <Bot className="w-4 h-4 mt-0.5 shrink-0 text-violet-400" />
                                <p>Con DeepSeek activo, el contenido de todas las hojas se envía al proveedor para localizar y organizar los marcajes. El archivo original no se conserva y el ERP valida cada resultado antes de guardarlo.</p>
                            </div>
                            <button onClick={() => void sendFile("preview")} disabled={!selectedFile || busy} className="shrink-0 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                                Interpretar archivo
                            </button>
                        </div>

                        {preview && (
                            <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                                <div className="p-4 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium text-white">Vista previa · {preview.fileName}</p>
                                        <p className="text-xs text-neutral-500 mt-1">{dateLabel(preview.periodStart)} – {dateLabel(preview.periodEnd)} · {preview.rowsDetected} jornadas · {preview.unmatchedCount} sin coincidencia</p>
                                    </div>
                                    <button onClick={() => void sendFile("commit")} disabled={busy || preview.rowsReady <= 0} className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
                                        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                        Confirmar y guardar
                                    </button>
                                </div>

                                {preview.sheetRoles.length > 0 && (
                                    <div className="px-4 py-3 border-b border-white/10 flex flex-wrap gap-2">
                                        {preview.sheetRoles.map((sheet) => (
                                            <span
                                                key={`${sheet.sheetIndex}-${sheet.sheetName}`}
                                                className={cn(
                                                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px]",
                                                    sheet.role === "attendance_source"
                                                        ? "bg-violet-500/10 border-violet-400/25 text-violet-200"
                                                        : "bg-white/[0.03] border-white/10 text-neutral-400",
                                                )}
                                            >
                                                <span className="font-medium">{sheet.sheetName}</span>
                                                <span className="text-neutral-500">·</span>
                                                {sheetRoleLabel[sheet.role]}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {(preview.warnings.length > 0 || preview.unmatchedCodes.length > 0) && (
                                    <div className="px-4 py-3 bg-amber-500/[0.05] border-b border-amber-500/10 text-xs text-amber-200">
                                        {preview.unmatchedCodes.length > 0 && <p>Códigos no encontrados: {preview.unmatchedCodes.join(", ")}</p>}
                                        {preview.warnings.slice(0, 3).map((warning, index) => <p key={index}>{warning}</p>)}
                                        {preview.warnings.length > 3 && <p>Y {preview.warnings.length - 3} advertencias más.</p>}
                                    </div>
                                )}

                                <div className="max-h-80 overflow-auto">
                                    <table className="w-full min-w-[720px] text-xs">
                                        <thead className="sticky top-0 bg-[#171a1f] text-neutral-400">
                                            <tr>
                                                <th className="px-3 py-2 text-left">Empleado</th>
                                                <th className="px-3 py-2 text-left">Fecha</th>
                                                <th className="px-3 py-2 text-left">Entrada</th>
                                                <th className="px-3 py-2 text-left">Salida</th>
                                                <th className="px-3 py-2 text-right">Horas</th>
                                                <th className="px-3 py-2 text-left">Acción</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.05]">
                                            {preview.records.map((record, index) => (
                                                <tr key={`${record.employeeCode}-${record.workDate}-${index}`}>
                                                    <td className="px-3 py-2"><p className="text-white">{record.employeeName || record.employeeCode}</p>{record.employeeName && <p className="font-mono text-[10px] text-neutral-600">{record.employeeCode}</p>}</td>
                                                    <td className="px-3 py-2">{record.workDate}</td>
                                                    <td className="px-3 py-2 font-mono">{timeLabel(record.checkIn)}</td>
                                                    <td className="px-3 py-2 font-mono">{timeLabel(record.checkOut)}</td>
                                                    <td className="px-3 py-2 text-right font-mono">{hoursLabel(record.workedMinutes)}</td>
                                                    <td className="px-3 py-2">
                                                        <span className={cn(
                                                            "inline-flex px-2 py-1 rounded-full border text-[10px]",
                                                            record.action === "insert" && "bg-cyan-500/10 border-cyan-500/20 text-cyan-300",
                                                            record.action === "complete" && "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
                                                            record.action === "unchanged" && "bg-neutral-500/10 border-neutral-500/20 text-neutral-400",
                                                            (record.action === "conflict" || record.action === "unmatched") && "bg-amber-500/10 border-amber-500/20 text-amber-300",
                                                        )}>{actionLabel[record.action]}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-neutral-900/70 p-5 rounded-3xl border border-white/10">
                        <div className="flex items-center gap-2 mb-4"><CalendarDays className="w-5 h-5 text-cyan-300" /><h2 className="text-lg font-semibold text-white">Cargas recientes</h2></div>
                        {(weekly?.uploads.length || 0) === 0 ? (
                            <p className="text-sm text-neutral-500 text-center py-10">Aún no hay archivos procesados.</p>
                        ) : (
                            <ul className="divide-y divide-white/[0.07]">
                                {weekly?.uploads.map((upload) => (
                                    <li key={upload.id} className="py-3.5 first:pt-0 last:pb-0">
                                        <div className="flex items-start gap-3">
                                            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/10"><FileSpreadsheet className="w-4 h-4 text-cyan-300" /></div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm text-white truncate">{upload.file_name}</p>
                                                <p className="text-[11px] text-neutral-500 mt-0.5">{dateLabel(upload.period_start)} – {dateLabel(upload.period_end)} · {new Date(upload.uploaded_at).toLocaleDateString("es-MX")}</p>
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px]">
                                                    <span className="text-cyan-300">{upload.rows_inserted} nuevas</span>
                                                    <span className="text-emerald-300">{upload.rows_updated} completadas</span>
                                                    <span className="text-neutral-500">{upload.rows_unchanged} repetidas</span>
                                                    {upload.rows_unmatched > 0 && <span className="text-amber-300">{upload.rows_unmatched} sin empleado</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}

function Metric({ icon, label, value, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; tone?: "neutral" | "cyan" | "emerald" | "amber" }) {
    return (
        <div className="px-4 py-3.5 border-r border-b md:border-b-0 border-white/[0.07] last:border-r-0">
            <div className={cn(
                "flex items-center gap-1.5 text-[10px] uppercase tracking-wider",
                tone === "neutral" && "text-neutral-500",
                tone === "cyan" && "text-cyan-400",
                tone === "emerald" && "text-emerald-400",
                tone === "amber" && "text-amber-400",
            )}>{icon}{label}</div>
            <p className="text-xl font-semibold text-white mt-1">{value}</p>
        </div>
    );
}
