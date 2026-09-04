"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { calculatePayrollAction } from "@/app/actions/payroll";
import {
    ArrowLeft, Banknote, RefreshCw, Calculator, CheckCircle2, X, Eye, Save, Download, FileText
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Period = {
    id: string; period_type: string; start_date: string; end_date: string; payment_date: string | null;
    status: string; total_gross: number; total_deductions: number; total_net: number;
};

export default function PayrollDetailPage() {
    const params = useParams();
    const router = useRouter();
    const periodId = params?.id as string;

    const [period, setPeriod] = useState<Period | null>(null);
    const [receipts, setReceipts] = useState<any[]>([]);
    const [empList, setEmpList] = useState<Array<{ employee_id: string; code: string | null; full_name: string }>>([]);
    // Avisos del motor de nómina (tabla de ISR prorrateada, SBC estimado, etc.)
    const [warnings, setWarnings] = useState<string[]>([]);
    const [warningLabels, setWarningLabels] = useState<Record<string, string>>({});
    const [configError, setConfigError] = useState<{ error: string; action?: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);

    const flash = (type: "error" | "success" | "info", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 4000);
    };

    const load = async () => {
        setLoading(true);
        try {
            const { data: p, error: pErr } = await supabase
                .from("payroll_periods").select("*").eq("id", periodId).single();
            if (pErr) throw pErr;
            setPeriod(p);

            // Los recibos ya vienen calculados del servidor. El navegador no
            // vuelve a leer sueldos, bonos ni checador: sólo el resultado.
            const { data: rs } = await supabase
                .from("payroll_receipts")
                .select("*")
                .eq("period_id", periodId);

            const { data: emps } = await supabase
                .from("v_payroll_employees")
                .select("employee_id, code, full_name");
            setEmpList((emps || []) as any);
            const nameById = new Map((emps || []).map((e: any) => [e.employee_id, e]));

            const merged = (rs || []).map((r: any) => ({
                ...r,
                employee: nameById.get(r.employee_id) ?? { full_name: "—", code: "—" },
            })).sort((a: any, b: any) =>
                (a.employee.full_name || "").localeCompare(b.employee.full_name || ""));
            setReceipts(merged);

            // Avisos guardados en el último cálculo
            const allWarnings = new Set<string>();
            for (const r of merged) {
                for (const w of (r.calc_warnings || [])) allWarnings.add(w);
            }
            setWarnings([...allWarnings]);
        } catch (e: any) { flash("error", e?.message || "Error"); }
        finally { setLoading(false); }
    };
    useEffect(() => { if (periodId) load(); }, [periodId]);

    const calculatePayroll = async () => {
        setBusy(true);
        setConfigError(null);
        try {
            const res = await calculatePayrollAction(periodId);
            if (!res.ok) {
                // Falta un dato fiscal: el motor se detuvo a propósito en vez
                // de calcular con parámetros vencidos.
                setConfigError({ error: res.error, action: res.action });
                flash("error", res.error);
                return;
            }
            setWarningLabels(res.warningLabels);
            if (res.result.blockers.length > 0) {
                setConfigError({ error: res.result.blockers.join(" ") });
                flash("error", res.result.blockers[0]);
                return;
            }
            flash("success",
                `Nómina calculada: ${res.result.receipts.length} recibos · Neto ${fmt(res.result.totals.net)}`);
            await load();
        } catch (e: any) {
            flash("error", e?.message || "Error al calcular.");
        } finally { setBusy(false); }
    };

    const approvePeriod = async () => {
        if (!period) return;
        await supabase.from("payroll_periods").update({ status: "approved" }).eq("id", periodId);
        flash("success", "Periodo aprobado.");
        load();
    };
    const payPeriod = async () => {
        if (!period) return;
        await supabase.from("payroll_periods").update({ status: "paid" }).eq("id", periodId);
        // Marcar todos los recibos como pagados
        await supabase.from("payroll_receipts").update({ paid_at: new Date().toISOString() }).eq("period_id", periodId);
        flash("success", "Periodo marcado como pagado.");
        load();
    };
    const revertToDraft = async () => {
        if (!confirm("¿Revertir a borrador? Se borrarán los recibos.")) return;
        await supabase.from("payroll_receipts").delete().eq("period_id", periodId);
        await supabase.from("payroll_periods").update({ status: "draft", total_gross: 0, total_deductions: 0, total_net: 0 }).eq("id", periodId);
        load();
    };

    const downloadPDF = async (r: any) => {
        const emp = r.employee;
        const lines: any[] = [];
        const { data: ls } = await supabase.from("payroll_receipt_lines").select("*").eq("receipt_id", r.id).order("sort_order");
        (ls || []).forEach((l: any) => lines.push(l));

        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.text("Recibo de Nómina", 14, 18);
        doc.setFontSize(10);
        doc.text(`Periodo: ${new Date(period!.start_date).toLocaleDateString()} → ${new Date(period!.end_date).toLocaleDateString()}`, 14, 26);
        doc.text(`Tipo: ${period!.period_type}`, 14, 31);
        doc.text(`Empleado: ${emp?.full_name} (${emp?.code})`, 14, 36);

        const percepciones = lines.filter(l => l.type === "perception");
        const deducciones = lines.filter(l => l.type === "deduction");
        const allRows: any[] = [
            ...percepciones.map(l => ["Percepción", l.concept, fmt(l.amount)]),
            ...deducciones.map(l => ["Deducción", l.concept, `−${fmt(l.amount)}`]),
        ];
        autoTable(doc, {
            startY: 42,
            head: [["Tipo", "Concepto", "Monto"]],
            body: allRows,
            foot: [
                ["", "TOTAL BRUTO", fmt(r.gross_salary)],
                ["", "TOTAL DEDUCCIONES", `−${fmt(r.total_deductions)}`],
                ["", "NETO A PAGAR", fmt(r.net_salary)],
            ],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [245, 158, 11] },
        });
        doc.save(`recibo-${emp?.code || r.employee_id}.pdf`);
    };

    if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-amber-400" /></div>;
    if (!period) return <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">Periodo no encontrado.</div>;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/finance/payroll" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                                <Banknote className="w-6 h-6 text-amber-400" />
                                Periodo {new Date(period.start_date).toLocaleDateString()} → {new Date(period.end_date).toLocaleDateString()}
                            </h1>
                            <p className="text-xs text-neutral-500 mt-0.5">
                                {period.period_type} · Estatus: <span className="text-amber-300 font-semibold uppercase">{period.status}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {period.status === "draft" && (
                            <button onClick={calculatePayroll} disabled={busy} className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50">
                                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} Calcular nómina
                            </button>
                        )}
                        {period.status === "calculated" && (
                            <>
                                <button onClick={revertToDraft} className="text-sm text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-lg border border-neutral-700">Revertir</button>
                                <button onClick={approvePeriod} className="text-sm bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4" /> Aprobar
                                </button>
                            </>
                        )}
                        {period.status === "approved" && (
                            <button onClick={payPeriod} className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" /> Marcar como pagado
                            </button>
                        )}
                    </div>
                </header>

                {msg && (
                    <div className={cn("p-3 rounded-xl border flex items-center gap-2",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        msg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
                        "bg-sky-500/10 border-sky-500/30 text-sky-300"
                    )}>
                        {msg.type === "error" ? <X className="w-4 h-4" /> : msg.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <Calculator className="w-4 h-4" />} {msg.text}
                    </div>
                )}

                {/* Falta un parámetro fiscal: el motor se detuvo en vez de
                    calcular con datos vencidos. Se dice qué cargar y dónde. */}
                {configError && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 space-y-2">
                        <div className="flex items-start gap-2 text-red-300">
                            <X className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <span className="text-sm font-semibold">{configError.error}</span>
                        </div>
                        {configError.action && (
                            <p className="text-xs text-red-200/80 pl-6 leading-relaxed">
                                <span className="uppercase tracking-wider text-[10px] text-red-300/60">Qué hacer</span>
                                <br />{configError.action}
                            </p>
                        )}
                    </div>
                )}

                {/* Avisos no bloqueantes: se calculó, pero con salvedades. */}
                {warnings.length > 0 && (
                    <div className="p-4 rounded-xl border bg-amber-500/10 border-amber-500/30 space-y-1.5">
                        <p className="text-xs uppercase tracking-wider text-amber-300/70 font-semibold">
                            Avisos del cálculo ({warnings.length})
                        </p>
                        <ul className="text-xs text-amber-200/90 space-y-1">
                            {warnings.map(w => (
                                <li key={w} className="flex gap-2">
                                    <span className="text-amber-400">·</span>
                                    <span>{warningLabels[w] ?? w}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Resumen */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <SummaryCard label="Total bruto" value={fmt(period.total_gross)} color="emerald" />
                    <SummaryCard label="Total deducciones" value={`−${fmt(period.total_deductions)}`} color="rose" />
                    <SummaryCard label="Neto a pagar" value={fmt(period.total_net)} color="amber" />
                </div>

                {/* Empleados a procesar (sin sueldos: el cálculo vive en el servidor) */}
                {receipts.length === 0 && (
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                        <h3 className="text-sm font-semibold text-white mb-3">Empleados a procesar ({empList.length})</h3>
                        <p className="text-xs text-neutral-400 mb-3">
                            Al calcular, el servidor genera un recibo por empleado con: salario del periodo +
                            horas del checador + bonos fijos, y retiene ISR (tarifa vigente del Anexo 8),
                            subsidio al empleo y cuotas obrero del IMSS sobre el SBC.
                        </p>
                        <ul className="text-xs text-neutral-300 space-y-1 max-h-64 overflow-y-auto">
                            {empList.map(e => (
                                <li key={e.employee_id} className="flex items-center justify-between py-1.5 border-b border-neutral-700/30 last:border-0">
                                    <span>{e.full_name}</span>
                                    <span className="text-neutral-500 font-mono text-[11px]">{e.code}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Recibos */}
                {receipts.length > 0 && (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                        <div className="p-5 border-b border-neutral-700/50 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white">Recibos ({receipts.length})</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                    <tr>
                                        <th className="px-5 py-3">Empleado</th>
                                        <th className="px-5 py-3">Días</th>
                                        <th className="px-5 py-3">Horas</th>
                                        <th className="px-5 py-3 text-right">Bruto</th>
                                        <th className="px-5 py-3 text-right">ISR</th>
                                        <th className="px-5 py-3 text-right">IMSS</th>
                                        <th className="px-5 py-3 text-right">Deducciones fijas</th>
                                        <th className="px-5 py-3 text-right">Neto</th>
                                        <th className="px-5 py-3 text-right">PDF</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-700/50">
                                    {receipts.map(r => (
                                        <tr key={r.id} className="hover:bg-neutral-800/60">
                                            <td className="px-5 py-3 font-medium text-white">{r.employee?.full_name}</td>
                                            <td className="px-5 py-3 text-neutral-300">{r.days_worked}</td>
                                            <td className="px-5 py-3 text-neutral-300 text-xs">{Number(r.hours_worked).toFixed(1)} h (+{Number(r.overtime_hours).toFixed(1)} ext)</td>
                                            <td className="px-5 py-3 text-right font-mono text-emerald-300">{fmt(r.gross_salary)}</td>
                                            <td className="px-5 py-3 text-right font-mono text-rose-300">{fmt(r.isr)}</td>
                                            <td className="px-5 py-3 text-right font-mono text-rose-300">{fmt(r.imss)}</td>
                                            <td className="px-5 py-3 text-right font-mono text-rose-300">{fmt(r.fixed_deductions)}</td>
                                            <td className="px-5 py-3 text-right font-mono text-white font-bold">{fmt(r.net_salary)}</td>
                                            <td className="px-5 py-3 text-right">
                                                <button onClick={() => downloadPDF(r)} className="p-1.5 text-amber-400 hover:text-white hover:bg-amber-500/20 rounded transition-colors" title="Descargar PDF">
                                                    <Download className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryCard({ label, value, color }: any) {
    const colors: Record<string, string> = {
        emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
        rose: "border-rose-500/30 bg-rose-500/5 text-rose-200",
        amber: "border-amber-500/30 bg-amber-500/5 text-amber-200",
    };
    return (
        <div className={cn("rounded-2xl border p-5", colors[color])}>
            <p className="text-xs uppercase tracking-wider opacity-80">{label}</p>
            <p className="text-3xl font-bold mt-1 text-white font-mono">{value}</p>
        </div>
    );
}
