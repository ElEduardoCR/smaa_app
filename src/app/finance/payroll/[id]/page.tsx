"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
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

// Tarifas ISR mensual aproximadas (régimen general) - tabla oficial
// (Base gravable hasta, Cuota fija, % sobre excedente)
const ISR_TABLE_MENSUAL = [
    { hasta: 746.04,  cuota: 0,      pct: 0.0192 },
    { hasta: 5062.17, cuota: 14.32,  pct: 0.0640 },
    { hasta: 8888.50, cuota: 296.04, pct: 0.1088 },
    { hasta: 13298.83, cuota: 692.96, pct: 0.16 },
    { hasta: 17688.16, cuota: 1292.16, pct: 0.1792 },
    { hasta: 35412.32, cuota: 2128.40, pct: 0.2136 },
    { hasta: 59074.16, cuota: 5665.16, pct: 0.2352 },
    { hasta: 118086.32, cuota: 12262.48, pct: 0.30 },
    { hasta: 9999999,  cuota: 32270.60, pct: 0.35 },
];

function calcISRMensual(base: number): number {
    if (base <= 0) return 0;
    let prevHasta = 0;
    for (const bracket of ISR_TABLE_MENSUAL) {
        if (base <= bracket.hasta) {
            const excedente = base - prevHasta;
            return bracket.cuota + excedente * bracket.pct;
        }
        prevHasta = bracket.hasta;
    }
    return 0;
}

// Aproximación simple para IMSS obrero (3% del SBC)
function calcIMSSEmployee(sbc: number): number {
    return Math.max(0, sbc * 0.03);
}

export default function PayrollDetailPage() {
    const params = useParams();
    const router = useRouter();
    const periodId = params?.id as string;

    const [period, setPeriod] = useState<Period | null>(null);
    const [employees, setEmployees] = useState<any[]>([]);
    const [bonusesMap, setBonusesMap] = useState<Record<string, any[]>>({});
    const [deductionsMap, setDeductionsMap] = useState<Record<string, any[]>>({});
    const [entriesMap, setEntriesMap] = useState<Record<string, any[]>>({});
    const [receipts, setReceipts] = useState<any[]>([]);
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
            const { data: p, error: pErr } = await supabase.from("payroll_periods").select("*").eq("id", periodId).single();
            if (pErr) throw pErr;
            setPeriod(p);

            const { data: emps } = await supabase.from("employees").select("*").eq("status", "active").order("full_name");
            setEmployees(emps || []);

            const { data: bs } = await supabase.from("employee_bonuses").select("*").eq("active", true);
            const bm: Record<string, any[]> = {};
            (bs || []).forEach((b: any) => { (bm[b.employee_id] = bm[b.employee_id] || []).push(b); });
            setBonusesMap(bm);

            const { data: ds } = await supabase.from("employee_deductions").select("*").eq("active", true);
            const dm: Record<string, any[]> = {};
            (ds || []).forEach((d: any) => { (dm[d.employee_id] = dm[d.employee_id] || []).push(d); });
            setDeductionsMap(dm);

            // Cargar entradas del checador para este periodo
            const { data: tcu } = await supabase
                .from("time_clock_uploads")
                .select("id")
                .gte("period_end", p.start_date)
                .lte("period_start", p.end_date);
            const uploadIds = (tcu || []).map((u: any) => u.id);
            let entries: any[] = [];
            if (uploadIds.length > 0) {
                const { data: te } = await supabase
                    .from("time_clock_entries")
                    .select("*")
                    .in("upload_id", uploadIds)
                    .gte("work_date", p.start_date)
                    .lte("work_date", p.end_date);
                entries = te || [];
            }
            const em: Record<string, any[]> = {};
            entries.forEach((e: any) => {
                if (!e.employee_id) return;
                (em[e.employee_id] = em[e.employee_id] || []).push(e);
            });
            setEntriesMap(em);

            // Recibos ya existentes
            const { data: rs } = await supabase
                .from("payroll_receipts")
                .select("*, employee:employees(full_name, code)")
                .eq("period_id", periodId);
            setReceipts(rs || []);
        } catch (e: any) { flash("error", e?.message || "Error"); }
        finally { setLoading(false); }
    };
    useEffect(() => { if (periodId) load(); }, [periodId]);

    const calculatePayroll = async () => {
        if (!period) return;
        if (employees.length === 0) { flash("error", "No hay empleados activos."); return; }
        setBusy(true);
        try {
            const startD = new Date(period.start_date);
            const endD = new Date(period.end_date);
            const daysInPeriod = Math.ceil((endD.getTime() - startD.getTime()) / 86400000) + 1;
            const periodFactor = period.period_type === "monthly" ? 1 : period.period_type === "biweekly" ? 0.5 : 0.25;

            let totalGross = 0, totalDed = 0, totalNet = 0;
            const newReceipts: any[] = [];

            for (const emp of employees) {
                const paymentType = emp.payment_type;
                const periodSalary = paymentType === "monthly" ? Number(emp.base_salary) * periodFactor
                    : paymentType === "biweekly" ? Number(emp.base_salary)
                    : paymentType === "weekly" ? Number(emp.base_salary) * (daysInPeriod / 7)
                    : paymentType === "daily" ? Number(emp.base_salary) * daysInPeriod
                    : 0;

                // Calcular horas del checador
                const empEntries = entriesMap[emp.id] || [];
                const totalHours = empEntries.reduce((acc, e) => acc + Number(e.hours_worked || 0), 0);
                const totalOvertime = empEntries.reduce((acc, e) => acc + Number(e.overtime_hours || 0), 0);
                const daysWorked = empEntries.length;

                let basePay = periodSalary;
                let overtimePay = 0;
                if (paymentType === "hourly") {
                    const regularHours = Math.min(totalHours, (Number(emp.weekly_hours) || 48) * (daysInPeriod / 7));
                    basePay = regularHours * Number(emp.hourly_rate || 0);
                    overtimePay = totalOvertime * Number(emp.hourly_rate || 0) * Number(emp.overtime_factor || 2);
                } else {
                    // Para asalariados, overtime se paga si el checador muestra horas extra
                    if (totalOvertime > 0) {
                        const hourlyEquiv = (Number(emp.base_salary) / 30) / 8;
                        overtimePay = totalOvertime * hourlyEquiv * Number(emp.overtime_factor || 2);
                    }
                }

                // Bonos fijos del periodo
                const empBonuses = bonusesMap[emp.id] || [];
                const fixedBonuses = empBonuses
                    .filter(b => b.frequency === period.period_type || (period.period_type === "biweekly" && b.frequency === "monthly" ? false : true))
                    .filter(b => b.is_fixed);
                const bonusesTotal = fixedBonuses.reduce((acc, b) => {
                    if (b.frequency === "monthly" && period.period_type !== "monthly") return acc + Number(b.amount) * periodFactor;
                    return acc + Number(b.amount);
                }, 0);

                const grossSalary = basePay + overtimePay + bonusesTotal;

                // ISR (mensual sobre base gravable, prorrateado a periodo)
                const monthlyBase = grossSalary / (period.period_type === "monthly" ? 1 : period.period_type === "biweekly" ? 2 : 4);
                const isrMonthly = calcISRMensual(monthlyBase);
                const isr = isrMonthly * (period.period_type === "monthly" ? 1 : period.period_type === "biweekly" ? 0.5 : 0.25);

                // IMSS obrero (3% SBC aprox)
                const sbc = (Number(emp.daily_salary) || (Number(emp.base_salary) / 30)) * 1.0453;
                const imss = calcIMSSEmployee(sbc) * (period.period_type === "monthly" ? 30 : period.period_type === "biweekly" ? 15 : 7) / 30 * (daysWorked / Math.max(daysInPeriod, 1));

                // Deducciones fijas
                const empDeds = deductionsMap[emp.id] || [];
                const fixedDed = empDeds.reduce((acc, d) => acc + Number(d.amount_per_period), 0);

                const totalDeductions = isr + imss + fixedDed;
                const netSalary = grossSalary - totalDeductions;

                totalGross += grossSalary;
                totalDed += totalDeductions;
                totalNet += netSalary;

                // Construir recibo
                const lines: any[] = [
                    { concept: paymentType === "hourly" ? `Salario por horas (${fmt(totalHours - totalOvertime)} h)` : "Sueldo base", type: "perception", amount: basePay, is_taxable: true },
                ];
                if (overtimePay > 0) lines.push({ concept: `Horas extra (${fmt(totalOvertime)} h × ${emp.overtime_factor})`, type: "perception", amount: overtimePay, is_taxable: true });
                fixedBonuses.forEach(b => lines.push({ concept: b.concept, type: "perception", amount: b.frequency === "monthly" && period.period_type !== "monthly" ? Number(b.amount) * periodFactor : Number(b.amount), is_taxable: b.is_taxable }));
                if (isr > 0) lines.push({ concept: "ISR", type: "deduction", amount: isr, is_taxable: false });
                if (imss > 0) lines.push({ concept: "IMSS obrero", type: "deduction", amount: imss, is_taxable: false });
                empDeds.forEach(d => lines.push({ concept: d.concept, type: "deduction", amount: Number(d.amount_per_period), is_taxable: false }));

                newReceipts.push({
                    period_id: periodId,
                    employee_id: emp.id,
                    days_worked: daysWorked,
                    hours_worked: totalHours,
                    overtime_hours: totalOvertime,
                    base_salary: basePay,
                    overtime_pay: overtimePay,
                    bonuses_total: bonusesTotal,
                    other_income: 0,
                    gross_salary: grossSalary,
                    isr,
                    imss,
                    fixed_deductions: fixedDed,
                    other_deductions: 0,
                    total_deductions: totalDeductions,
                    net_salary: netSalary,
                    lines,
                });
            }

            // Borrar recibos anteriores
            await supabase.from("payroll_receipts").delete().eq("period_id", periodId);

            // Insertar nuevos recibos + líneas
            for (const r of newReceipts) {
                const { lines, ...receipt } = r;
                const { data: ins, error: iErr } = await supabase.from("payroll_receipts").insert([receipt]).select().single();
                if (iErr) throw iErr;
                const linesWithId = lines.map((l: any, i: number) => ({ ...l, receipt_id: ins.id, sort_order: i }));
                await supabase.from("payroll_receipt_lines").insert(linesWithId);
            }

            // Actualizar totales del periodo
            await supabase.from("payroll_periods").update({
                status: "calculated",
                total_gross: totalGross,
                total_deductions: totalDed,
                total_net: totalNet,
            }).eq("id", periodId);

            flash("success", `Nómina calculada: ${employees.length} recibos · Total ${fmt(totalNet)}`);
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al calcular."); }
        finally { setBusy(false); }
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
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
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

                {/* Resumen */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <SummaryCard label="Total bruto" value={fmt(period.total_gross)} color="emerald" />
                    <SummaryCard label="Total deducciones" value={`−${fmt(period.total_deductions)}`} color="rose" />
                    <SummaryCard label="Neto a pagar" value={fmt(period.total_net)} color="amber" />
                </div>

                {/* Empleados preview (cuando aún no se calcula) */}
                {receipts.length === 0 && (
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                        <h3 className="text-sm font-semibold text-white mb-3">Empleados a procesar ({employees.length})</h3>
                        <p className="text-xs text-neutral-400 mb-3">
                            Cuando le des a "Calcular nómina", se generará un recibo por empleado usando:
                            salario base + horas del checador del periodo + bonos fijos + ISR/IMSS calculado.
                        </p>
                        <ul className="text-xs text-neutral-300 space-y-1 max-h-64 overflow-y-auto">
                            {employees.map(e => (
                                <li key={e.id} className="flex items-center justify-between py-1.5 border-b border-neutral-700/30 last:border-0">
                                    <span>{e.full_name} <span className="text-neutral-500">({e.code})</span></span>
                                    <span className="font-mono text-emerald-300">
                                        {e.payment_type === "hourly" ? `${fmt(e.hourly_rate)}/h` : fmt(e.base_salary)}
                                        <span className="text-neutral-500 ml-2 text-[10px] uppercase">{e.payment_type}</span>
                                    </span>
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
