"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, User, Mail, Phone, MapPin, Calendar, Banknote, Briefcase, RefreshCw,
    Edit, AlertCircle, Plus, Trash2, Gift, Minus, Save, X, Check
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAY_LABEL: Record<string, string> = {
    monthly: "Mensual", biweekly: "Quincenal", weekly: "Semanal", hourly: "Por hora", daily: "Diario",
};

type Employee = {
    id: string; code: string; full_name: string; rfc: string | null; curp: string | null; nss: string | null;
    email: string | null; phone: string | null; address: string | null; birth_date: string | null;
    hire_date: string; termination_date: string | null; status: string; position: string | null;
    department: string | null; payment_type: string; base_salary: number; daily_salary: number;
    hourly_rate: number; overtime_factor: number; weekly_hours: number; bank_name: string | null;
    bank_account: string | null; clabe: string | null; isr_subsidy_eligible: boolean;
    imss_modality: string; notes: string | null;
};

type Bonus = { id: string; concept: string; amount: number; frequency: string; is_taxable: boolean; is_fixed: boolean; active: boolean; notes: string | null; };
type Deduction = { id: string; concept: string; amount_per_period: number; total_amount: number | null; remaining_amount: number | null; is_payroll_deduction: boolean; active: boolean; notes: string | null; };
type Receipt = { id: string; period_id: string; gross_salary: number; net_salary: number; total_deductions: number; period?: { start_date: string; end_date: string; period_type: string; } };

export default function EmployeeDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params?.id as string;

    const [emp, setEmp] = useState<Employee | null>(null);
    const [bonuses, setBonuses] = useState<Bonus[]>([]);
    const [deductions, setDeductions] = useState<Deduction[]>([]);
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"info" | "bonuses" | "deductions" | "receipts">("info");
    const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("payroll_employees").select("*").eq("id", id).single();
            if (error) throw error;
            setEmp(data);
            const [{ data: bs }, { data: ds }, { data: rs }] = await Promise.all([
                supabase.from("employee_bonuses").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
                supabase.from("employee_deductions").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
                supabase.from("payroll_receipts").select("id, period_id, gross_salary, net_salary, total_deductions, period:payroll_periods(start_date, end_date, period_type)").eq("employee_id", id).order("created_at", { ascending: false }).limit(20),
            ]);
            setBonuses(bs || []);
            setDeductions(ds || []);
            const formatted = (rs || []).map((r: any) => ({ ...r, period: Array.isArray(r.period) ? r.period[0] : r.period }));
            setReceipts(formatted);
        } catch (e: any) { setMsg({ type: "error", text: e?.message || "Error" }); }
        finally { setLoading(false); }
    };
    useEffect(() => { if (id) load(); }, [id]);

    const flash = (type: "error" | "success", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 3500);
    };

    const handleTerminate = async () => {
        if (!emp) return;
        const reason = prompt("Motivo de baja (opcional):");
        if (reason === null) return;
        if (!confirm("¿Dar de baja a este empleado? Esta acción se puede revertir.")) return;
        await supabase.from("payroll_employees").update({
            status: "terminated",
            termination_date: new Date().toISOString().slice(0, 10),
        }).eq("id", emp.id);
        flash("success", "Empleado dado de baja.");
        await load();
    };

    if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-emerald-400" /></div>;
    if (!emp) return <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">Empleado no encontrado.</div>;

    const totalBonuses = bonuses.filter(b => b.active && b.is_fixed).reduce((acc, b) => acc + Number(b.amount), 0);
    const totalDeductions = deductions.filter(d => d.active).reduce((acc, d) => acc + Number(d.amount_per_period), 0);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/finance/employees" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white flex items-center gap-2 flex-wrap">
                                <User className="w-6 h-6 text-emerald-400" />
                                {emp.full_name}
                                <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{emp.code}</span>
                                <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase",
                                    emp.status === "active" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                                    emp.status === "terminated" ? "bg-red-500/10 text-red-300 border-red-500/30" :
                                    "bg-amber-500/10 text-amber-300 border-amber-500/30"
                                )}>
                                    {emp.status}
                                </span>
                            </h1>
                            <p className="text-xs text-neutral-500 mt-0.5">{emp.position || "—"} · {emp.department || "—"}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link href={`/finance/employees/new?id=${emp.id}`} className="text-sm flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-2 rounded-lg border border-neutral-700">
                            <Edit className="w-4 h-4" /> Editar
                        </Link>
                        {emp.status === "active" && (
                            <button onClick={handleTerminate} className="text-sm flex items-center gap-1.5 text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/30 px-3 py-2 rounded-lg border border-red-500/30">
                                <X className="w-4 h-4" /> Dar de baja
                            </button>
                        )}
                    </div>
                </header>

                {msg && (
                    <div className={cn("p-3 rounded-xl border flex items-center gap-2",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    )}>
                        {msg.type === "error" ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />} {msg.text}
                    </div>
                )}

                {/* Tabs */}
                <div className="flex flex-wrap gap-2">
                    {[
                        { k: "info", label: "Información" },
                        { k: "bonuses", label: `Bonos (${bonuses.length})` },
                        { k: "deductions", label: `Deducciones fijas (${deductions.length})` },
                        { k: "receipts", label: `Recibos (${receipts.length})` },
                    ].map(t => (
                        <button key={t.k} onClick={() => setTab(t.k as any)}
                            className={cn("text-sm px-4 py-2 rounded-xl border transition-colors",
                                tab === t.k ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" :
                                "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                            )}>
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === "info" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card title="Datos personales" Icon={User}>
                            <Row label="Nombre">{emp.full_name}</Row>
                            <Row label="Código">{emp.code}</Row>
                            <Row label="RFC">{emp.rfc || "—"}</Row>
                            <Row label="CURP">{emp.curp || "—"}</Row>
                            <Row label="NSS">{emp.nss || "—"}</Row>
                            <Row label="Nacimiento">{emp.birth_date || "—"}</Row>
                            <Row label="Email">{emp.email ? <a className="text-emerald-300 underline" href={`mailto:${emp.email}`}>{emp.email}</a> : "—"}</Row>
                            <Row label="Teléfono">{emp.phone || "—"}</Row>
                            <Row label="Dirección">{emp.address || "—"}</Row>
                            <Row label="Alta">{new Date(emp.hire_date).toLocaleDateString()}</Row>
                            {emp.termination_date && <Row label="Baja">{new Date(emp.termination_date).toLocaleDateString()}</Row>}
                        </Card>
                        <Card title="Puesto y pago" Icon={Briefcase}>
                            <Row label="Puesto">{emp.position || "—"}</Row>
                            <Row label="Departamento">{emp.department || "—"}</Row>
                            <Row label="Tipo de pago">{PAY_LABEL[emp.payment_type] || emp.payment_type}</Row>
                            <Row label={emp.payment_type === "hourly" ? "Tarifa por hora" : "Salario base"}>
                                <span className="font-mono text-emerald-300">{emp.payment_type === "hourly" ? fmt(emp.hourly_rate) + " /h" : fmt(emp.base_salary)}</span>
                            </Row>
                            {emp.daily_salary > 0 && <Row label="Salario diario"><span className="font-mono">{fmt(emp.daily_salary)}</span></Row>}
                            <Row label="Jornada semanal">{emp.weekly_hours} h</Row>
                            <Row label="Factor horas extra">×{emp.overtime_factor}</Row>
                            <Row label="Modalidad IMSS">{emp.imss_modality}</Row>
                            <Row label="Subsidio al empleo">{emp.isr_subsidy_eligible ? "Sí" : "No"}</Row>
                        </Card>
                        <Card title="Banco" Icon={Banknote}>
                            <Row label="Banco">{emp.bank_name || "—"}</Row>
                            <Row label="Cuenta">{emp.bank_account || "—"}</Row>
                            <Row label="CLABE">{emp.clabe || "—"}</Row>
                        </Card>
                        <Card title="Resumen" Icon={Banknote}>
                            <Row label="Bonos fijos mensuales"><span className="font-mono text-emerald-300">{fmt(totalBonuses)}</span></Row>
                            <Row label="Deducciones fijas / periodo"><span className="font-mono text-rose-300">−{fmt(totalDeductions)}</span></Row>
                            <Row label="Notas" colSpan={2}>{emp.notes || "—"}</Row>
                        </Card>
                    </div>
                )}

                {tab === "bonuses" && (
                    <BonusSection
                        employeeId={emp.id}
                        bonuses={bonuses}
                        onChange={load}
                        flash={flash}
                    />
                )}

                {tab === "deductions" && (
                    <DeductionSection
                        employeeId={emp.id}
                        deductions={deductions}
                        onChange={load}
                        flash={flash}
                    />
                )}

                {tab === "receipts" && (
                    <Card title="Historial de recibos" Icon={Calendar}>
                        {receipts.length === 0 ? (
                            <p className="text-sm text-neutral-500 text-center py-6">Este empleado aún no tiene recibos generados. Crea un periodo en <Link href="/finance/payroll" className="text-emerald-400 underline">Nómina</Link>.</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="text-xs text-neutral-400 uppercase tracking-wider">
                                    <tr><th className="text-left py-2">Periodo</th><th className="text-right">Bruto</th><th className="text-right">Deducciones</th><th className="text-right">Neto</th></tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-700/50">
                                    {receipts.map(r => (
                                        <tr key={r.id}>
                                            <td className="py-2 text-neutral-300">
                                                {r.period ? `${new Date(r.period.start_date).toLocaleDateString()} → ${new Date(r.period.end_date).toLocaleDateString()}` : "—"}
                                                <span className="text-[10px] text-neutral-500 ml-2 uppercase">{r.period?.period_type}</span>
                                            </td>
                                            <td className="text-right font-mono text-emerald-300">{fmt(r.gross_salary)}</td>
                                            <td className="text-right font-mono text-rose-300">−{fmt(r.total_deductions)}</td>
                                            <td className="text-right font-mono text-white font-bold">{fmt(r.net_salary)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Card>
                )}
            </div>
        </div>
    );
}

function Card({ title, Icon, children }: any) {
    return (
        <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                {Icon && <Icon className="w-4 h-4 text-emerald-400" />} {title}
            </h3>
            <div className="space-y-1.5 text-sm">{children}</div>
        </div>
    );
}
function Row({ label, children, colSpan }: any) {
    return (
        <div className={cn("flex items-start gap-3 py-1.5 border-b border-neutral-700/30 last:border-0", colSpan === 2 && "col-span-2")}>
            <span className="text-xs text-neutral-500 uppercase tracking-wider w-40 flex-shrink-0">{label}</span>
            <span className="text-neutral-200 flex-1">{children}</span>
        </div>
    );
}

function BonusSection({ employeeId, bonuses, onChange, flash }: any) {
    const [concept, setConcept] = useState("");
    const [amount, setAmount] = useState("");
    const [frequency, setFrequency] = useState("monthly");
    const [isTaxable, setIsTaxable] = useState(true);

    const add = async () => {
        if (!concept || !amount) { flash("error", "Concepto y monto requeridos."); return; }
        const { error } = await supabase.from("employee_bonuses").insert([{
            employee_id: employeeId, concept, amount: Number(amount), frequency, is_taxable: isTaxable, is_fixed: true, active: true,
        }]);
        if (error) { flash("error", error.message); return; }
        setConcept(""); setAmount("");
        flash("success", "Bono agregado.");
        onChange();
    };
    const del = async (id: string) => {
        if (!confirm("¿Eliminar este bono?")) return;
        await supabase.from("employee_bonuses").delete().eq("id", id);
        onChange();
    };

    return (
        <Card title="Bonos / percepciones fijas" Icon={Gift}>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 mb-3">
                <input value={concept} onChange={e => setConcept(e.target.value)} placeholder="Concepto (ej. Bono productividad)" className="sm:col-span-2 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                <input value={amount} onChange={e => setAmount(e.target.value)} type="number" step="0.01" placeholder="Monto" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                <select value={frequency} onChange={e => setFrequency(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                    <option value="monthly">Mensual</option>
                    <option value="biweekly">Quincenal</option>
                    <option value="weekly">Semanal</option>
                </select>
                <button onClick={add} className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> Agregar</button>
            </div>
            {bonuses.length === 0 ? <p className="text-sm text-neutral-500 text-center py-4">Sin bonos.</p> : (
                <ul className="divide-y divide-neutral-700/50">
                    {bonuses.map((b: any) => (
                        <li key={b.id} className="flex items-center gap-3 py-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-white">{b.concept}</p>
                                <p className="text-[11px] text-neutral-500">{b.frequency} {b.is_taxable ? "· gravable" : "· exento"} {b.active ? "" : "· inactivo"}</p>
                            </div>
                            <span className="font-mono text-emerald-300">{fmt(b.amount)}</span>
                            <button onClick={() => del(b.id)} className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

function DeductionSection({ employeeId, deductions, onChange, flash }: any) {
    const [concept, setConcept] = useState("");
    const [amountPerPeriod, setAmountPerPeriod] = useState("");
    const [totalAmount, setTotalAmount] = useState("");

    const add = async () => {
        if (!concept || !amountPerPeriod) { flash("error", "Concepto y monto requeridos."); return; }
        const total = Number(totalAmount) || 0;
        const { error } = await supabase.from("employee_deductions").insert([{
            employee_id: employeeId, concept, amount_per_period: Number(amountPerPeriod),
            total_amount: total || null, remaining_amount: total || null,
            is_payroll_deduction: true, active: true, started_at: new Date().toISOString().slice(0, 10),
        }]);
        if (error) { flash("error", error.message); return; }
        setConcept(""); setAmountPerPeriod(""); setTotalAmount("");
        flash("success", "Deducción agregada.");
        onChange();
    };
    const del = async (id: string) => {
        if (!confirm("¿Eliminar esta deducción?")) return;
        await supabase.from("employee_deductions").delete().eq("id", id);
        onChange();
    };

    return (
        <Card title="Deducciones fijas (préstamos, anticipos, etc.)" Icon={Minus}>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 mb-3">
                <input value={concept} onChange={e => setConcept(e.target.value)} placeholder="Concepto" className="sm:col-span-2 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                <input value={amountPerPeriod} onChange={e => setAmountPerPeriod(e.target.value)} type="number" step="0.01" placeholder="$ / periodo" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                <input value={totalAmount} onChange={e => setTotalAmount(e.target.value)} type="number" step="0.01" placeholder="Total adeudado" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                <button onClick={add} className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5"><Plus className="w-4 h-4" /> Agregar</button>
            </div>
            {deductions.length === 0 ? <p className="text-sm text-neutral-500 text-center py-4">Sin deducciones fijas.</p> : (
                <ul className="divide-y divide-neutral-700/50">
                    {deductions.map((d: any) => (
                        <li key={d.id} className="flex items-center gap-3 py-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-white">{d.concept}</p>
                                <p className="text-[11px] text-neutral-500">
                                    {d.total_amount ? `Adeudado: ${fmt(d.total_amount)} · Resta: ${fmt(d.remaining_amount)}` : "Sin tope"} {d.active ? "" : "· inactivo"}
                                </p>
                            </div>
                            <span className="font-mono text-rose-300">−{fmt(d.amount_per_period)}</span>
                            <button onClick={() => del(d.id)} className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
