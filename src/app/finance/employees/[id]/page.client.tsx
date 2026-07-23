"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, User, Mail, Phone, MapPin, Calendar, Banknote, Briefcase, RefreshCw,
    Edit, AlertCircle, Plus, Trash2, Gift, Minus, Save, X, Check, Lock
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
    id: string;
    username: string;
    full_name: string;
    role: string;
    position: string | null;
    phone: string | null;
    photo_url: string | null;
    is_active: boolean;
};

type Payroll = {
    id: string;
    employee_id: string;
    code: string;
    rfc: string | null;
    curp: string | null;
    nss: string | null;
    email: string | null;
    address: string | null;
    birth_date: string | null;
    hire_date: string;
    termination_date: string | null;
    status: string;
    department: string | null;
    payment_type: string;
    base_salary: number;
    daily_salary: number;
    hourly_rate: number;
    overtime_factor: number;
    weekly_hours: number;
    bank_name: string | null;
    bank_account: string | null;
    clabe: string | null;
    isr_subsidy_eligible: boolean;
    imss_modality: string;
    notes: string | null;
    created_at?: string;
    updated_at?: string;
};

type Bonus = { id: string; concept: string; amount: number; frequency: string; is_taxable: boolean; is_fixed: boolean; active: boolean; notes: string | null; };
type Deduction = { id: string; concept: string; amount_per_period: number; total_amount: number | null; remaining_amount: number | null; is_payroll_deduction: boolean; active: boolean; notes: string | null; };
type Receipt = { id: string; period_id: string; gross_salary: number; net_salary: number; total_deductions: number; period?: { start_date: string; end_date: string; period_type: string; } | null; };

export default function EmployeeDetailPage({ id: employeeId }: { id: string }) {
    const router = useRouter();

    const [emp, setEmp] = useState<Employee | null>(null);
    const [payroll, setPayroll] = useState<Payroll | null>(null);
    const [bonuses, setBonuses] = useState<Bonus[]>([]);
    const [deductions, setDeductions] = useState<Deduction[]>([]);
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"info" | "bonuses" | "deductions" | "receipts">("info");
    const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [saving, setSaving] = useState(false);

    const flash = (type: "error" | "success", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 3500);
    };

    const load = async () => {
        setLoading(true);
        try {
            // 1) Empleado (de la tabla unificada)
            const { data: e, error: eErr } = await supabase
                .from("employees")
                .select("id, username, full_name, role, position, phone, photo_url, is_active")
                .eq("id", employeeId)
                .single();
            if (eErr) throw eErr;
            setEmp(e);

            // 2) Datos de nómina (FK employee_id)
            const { data: p, error: pErr } = await supabase
                .from("payroll_employees")
                .select("*")
                .eq("employee_id", employeeId)
                .maybeSingle();
            if (pErr) throw pErr;
            setPayroll(p);

            // 3) Bonos, deducciones, recibos
            const [{ data: bs }, { data: ds }, { data: rs }] = await Promise.all([
                supabase.from("employee_bonuses").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }),
                supabase.from("employee_deductions").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }),
                supabase.from("payroll_receipts").select("id, period_id, gross_salary, net_salary, total_deductions, period:payroll_periods(start_date, end_date, period_type)").eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(20),
            ]);
            setBonuses(bs || []);
            setDeductions(ds || []);
            const formatted = (rs || []).map((r: any) => ({ ...r, period: Array.isArray(r.period) ? r.period[0] : r.period }));
            setReceipts(formatted);
        } catch (e: any) { flash("error", e?.message || "Error cargando empleado."); }
        finally { setLoading(false); }
    };
    useEffect(() => { if (employeeId) load(); }, [employeeId]);

    const handleSavePayroll = async () => {
        if (!payroll) return;
        setSaving(true);
        try {
            const { id, employee_id, code, created_at, updated_at, ...rest } = payroll;
            const { error } = await supabase.from("payroll_employees").update(rest).eq("id", id);
            if (error) throw error;
            flash("success", "Datos de nómina guardados.");
            setEditMode(false);
            await load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setSaving(false); }
    };

    const handleTerminate = async () => {
        if (!payroll) return;
        if (!confirm("¿Dar de baja a este empleado? Esta acción se puede revertir.")) return;
        const { error } = await supabase.from("payroll_employees").update({
            status: "terminated",
            termination_date: new Date().toISOString().slice(0, 10),
        }).eq("id", payroll.id);
        if (error) { flash("error", error.message); return; }
        flash("success", "Empleado dado de baja.");
        await load();
    };

    const setField = <K extends keyof Payroll>(key: K, val: Payroll[K]) => {
        setPayroll((p) => p ? { ...p, [key]: val } : p);
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
                        <div className="flex items-center gap-3">
                            {emp.photo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={emp.photo_url} alt={emp.full_name} className="w-12 h-12 rounded-xl object-cover" />
                            ) : (
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/30 to-teal-500/30 flex items-center justify-center text-sm font-bold text-emerald-200">
                                    {emp.full_name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                                </div>
                            )}
                            <div>
                                <h1 className="text-2xl font-bold text-white flex items-center gap-2 flex-wrap">
                                    {emp.full_name}
                                    {payroll && <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{payroll.code}</span>}
                                    {payroll && (
                                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase",
                                            payroll.status === "active" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                                            payroll.status === "terminated" ? "bg-red-500/10 text-red-300 border-red-500/30" :
                                            "bg-amber-500/10 text-amber-300 border-amber-500/30"
                                        )}>
                                            {payroll.status}
                                        </span>
                                    )}
                                </h1>
                                <p className="text-xs text-neutral-500 mt-0.5">
                                    {emp.position || "—"} · {payroll?.department || "—"} · @{emp.username}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link href={`/settings/employees`} className="text-sm flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-2 rounded-lg border border-neutral-700" title="Editar datos de sistema (rol, permisos, contraseña)">
                            <Lock className="w-4 h-4" /> Datos de sistema
                        </Link>
                        {!editMode && payroll && (
                            <button onClick={() => setEditMode(true)} className="text-sm flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg">
                                <Edit className="w-4 h-4" /> Editar nómina
                            </button>
                        )}
                        {editMode && (
                            <>
                                <button onClick={() => { setEditMode(false); load(); }} className="text-sm flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-2 rounded-lg border border-neutral-700">
                                    <X className="w-4 h-4" /> Cancelar
                                </button>
                                <button onClick={handleSavePayroll} disabled={saving} className="text-sm flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg disabled:opacity-50">
                                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                                </button>
                            </>
                        )}
                        {payroll && payroll.status === "active" && !editMode && (
                            <button onClick={handleTerminate} className="text-sm flex items-center gap-1.5 text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/30 px-3 py-2 rounded-lg border border-red-500/30">
                                Dar de baja
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

                {/* Banner de captura pendiente */}
                {payroll && (!payroll.rfc || !payroll.base_salary) && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-amber-200">Datos de nómina pendientes</p>
                            <p className="text-xs text-amber-300/80 mt-0.5">
                                {!payroll.rfc && "Falta capturar el RFC. "}
                                {!payroll.base_salary && "Falta capturar el salario base. "}
                                Este empleado no podrá aparecer en nóminas hasta completar estos datos.
                            </p>
                        </div>
                    </div>
                )}

                {!payroll && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold text-rose-200">No hay registro de nómina para este empleado</p>
                            <p className="text-xs text-rose-300/80 mt-0.5">El trigger debería haber creado un stub al insertar en employees. Si no existe, contacta al admin.</p>
                        </div>
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

                {tab === "info" && payroll && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card title="Datos personales" Icon={User}>
                            <Row label="Nombre">{emp.full_name}</Row>
                            <Row label="Código">{payroll.code}</Row>
                            <FieldRow label="RFC" editMode={editMode}><Input value={payroll.rfc || ""} onChange={(v: string) => setField("rfc", v.toUpperCase() || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="CURP" editMode={editMode}><Input value={payroll.curp || ""} onChange={(v: string) => setField("curp", v.toUpperCase() || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="NSS" editMode={editMode}><Input value={payroll.nss || ""} onChange={(v: string) => setField("nss", v || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="Nacimiento" editMode={editMode}><Input type="date" value={payroll.birth_date || ""} onChange={(v: string) => setField("birth_date", v || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="Email" editMode={editMode}><Input type="email" value={payroll.email || ""} onChange={(v: string) => setField("email", v || null)} disabled={!editMode} /></FieldRow>
                            <Row label="Teléfono (sistema)">{emp.phone || "—"}</Row>
                            <FieldRow label="Dirección" editMode={editMode} colSpan={2}><Textarea value={payroll.address || ""} onChange={(v: string) => setField("address", v || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="Fecha de alta" editMode={editMode}><Input type="date" value={payroll.hire_date || ""} onChange={(v: string) => setField("hire_date", v)} disabled={!editMode} /></FieldRow>
                            {payroll.termination_date && <Row label="Fecha de baja">{new Date(payroll.termination_date).toLocaleDateString()}</Row>}
                        </Card>
                        <Card title="Puesto y pago" Icon={Briefcase}>
                            <Row label="Puesto (sistema)">{emp.position || "—"}</Row>
                            <FieldRow label="Departamento" editMode={editMode}><Input value={payroll.department || ""} onChange={(v: string) => setField("department", v || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="Status" editMode={editMode}>
                                <select value={payroll.status} onChange={e => setField("status", e.target.value)} disabled={!editMode} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60">
                                    <option value="active">Activo</option>
                                    <option value="inactive">Inactivo</option>
                                    <option value="suspended">Suspendido</option>
                                </select>
                            </FieldRow>
                            <FieldRow label="Tipo de pago" editMode={editMode}>
                                <select value={payroll.payment_type} onChange={e => setField("payment_type", e.target.value)} disabled={!editMode} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60">
                                    {Object.entries(PAY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </FieldRow>
                            <FieldRow label={payroll.payment_type === "hourly" ? "Tarifa por hora" : "Salario base"} editMode={editMode}>
                                <Input type="number" step="0.01" value={payroll.base_salary || ""} onChange={(v: string) => setField("base_salary", Number(v) || 0)} disabled={!editMode} />
                            </FieldRow>
                            <FieldRow label="Salario diario" editMode={editMode}>
                                <Input type="number" step="0.01" value={payroll.daily_salary || ""} onChange={(v: string) => setField("daily_salary", Number(v) || 0)} disabled={!editMode} />
                            </FieldRow>
                            <FieldRow label="Jornada semanal (h)" editMode={editMode}>
                                <Input type="number" value={payroll.weekly_hours || ""} onChange={(v: string) => setField("weekly_hours", Number(v) || 0)} disabled={!editMode} />
                            </FieldRow>
                            <FieldRow label="Factor horas extra" editMode={editMode}>
                                <Input type="number" step="0.01" value={payroll.overtime_factor || ""} onChange={(v: string) => setField("overtime_factor", Number(v) || 2.0)} disabled={!editMode} />
                            </FieldRow>
                            <FieldRow label="Modalidad IMSS" editMode={editMode}>
                                <select value={payroll.imss_modality} onChange={e => setField("imss_modality", e.target.value)} disabled={!editMode} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60">
                                    <option value="ordinario">Ordinario</option>
                                    <option value="domestico">Doméstico</option>
                                    <option value="out">Outsourcing</option>
                                </select>
                            </FieldRow>
                            <FieldRow label="Aplica subsidio al empleo" editMode={editMode}>
                                <label className="flex items-center gap-2 text-sm text-neutral-200">
                                    <input type="checkbox" checked={payroll.isr_subsidy_eligible} onChange={e => setField("isr_subsidy_eligible", e.target.checked)} disabled={!editMode} className="w-4 h-4 rounded" />
                                    {payroll.isr_subsidy_eligible ? "Sí" : "No"}
                                </label>
                            </FieldRow>
                        </Card>
                        <Card title="Banco" Icon={Banknote}>
                            <FieldRow label="Banco" editMode={editMode}><Input value={payroll.bank_name || ""} onChange={(v: string) => setField("bank_name", v || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="Cuenta" editMode={editMode}><Input value={payroll.bank_account || ""} onChange={(v: string) => setField("bank_account", v || null)} disabled={!editMode} /></FieldRow>
                            <FieldRow label="CLABE" editMode={editMode}><Input value={payroll.clabe || ""} onChange={(v: string) => setField("clabe", v || null)} disabled={!editMode} /></FieldRow>
                        </Card>
                        <Card title="Resumen" Icon={Banknote}>
                            <Row label="Bonos fijos mensuales"><span className="font-mono text-emerald-300">{fmt(totalBonuses)}</span></Row>
                            <Row label="Deducciones fijas / periodo"><span className="font-mono text-rose-300">−{fmt(totalDeductions)}</span></Row>
                            <FieldRow label="Notas" editMode={editMode} colSpan={2}><Textarea value={payroll.notes || ""} onChange={(v: string) => setField("notes", v || null)} disabled={!editMode} rows={3} /></FieldRow>
                        </Card>
                    </div>
                )}

                {tab === "bonuses" && (
                    <BonusSection
                        employeeId={employeeId}
                        bonuses={bonuses}
                        onChange={load}
                        flash={flash}
                    />
                )}

                {tab === "deductions" && (
                    <DeductionSection
                        employeeId={employeeId}
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
function FieldRow({ label, editMode, children, colSpan }: any) {
    return (
        <div className={cn("flex items-start gap-3 py-1.5 border-b border-neutral-700/30 last:border-0", colSpan === 2 && "col-span-2")}>
            <span className="text-xs text-neutral-500 uppercase tracking-wider w-40 flex-shrink-0 pt-2">{label}</span>
            <div className="flex-1">{editMode ? children : <span className="text-neutral-200">{(children?.props?.value) || "—"}</span>}</div>
        </div>
    );
}
function Input({ value, onChange, disabled, type, step, placeholder }: any) {
    return (
        <input
            type={type || "text"}
            value={value}
            onChange={(e: any) => onChange(e.target.value)}
            disabled={disabled}
            step={step}
            placeholder={placeholder}
            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
        />
    );
}
function Textarea({ value, onChange, disabled, rows }: any) {
    return (
        <textarea
            value={value}
            onChange={(e: any) => onChange(e.target.value)}
            disabled={disabled}
            rows={rows || 2}
            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
        />
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
            {bonuses.length === 0 ? (
                <p className="text-sm text-neutral-500 text-center py-6">Sin bonos registrados.</p>
            ) : (
                <table className="w-full text-sm">
                    <thead className="text-xs text-neutral-400 uppercase tracking-wider">
                        <tr><th className="text-left py-2">Concepto</th><th className="text-right">Monto</th><th className="text-left pl-4">Frecuencia</th><th className="text-left pl-4">Gravable</th><th className="text-right">Activo</th><th></th></tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-700/50">
                        {bonuses.map((b: Bonus) => (
                            <tr key={b.id}>
                                <td className="py-2 text-neutral-200">{b.concept}</td>
                                <td className="text-right font-mono text-emerald-300">{fmt(b.amount)}</td>
                                <td className="pl-4 text-xs text-neutral-400 capitalize">{b.frequency === 'monthly' ? 'Mensual' : b.frequency === 'biweekly' ? 'Quincenal' : b.frequency === 'weekly' ? 'Semanal' : 'Una vez'}</td>
                                <td className="pl-4 text-xs text-neutral-400">{b.is_taxable ? "Sí" : "No"}</td>
                                <td className="text-right text-xs">{b.active ? "✅" : "—"}</td>
                                <td className="text-right">
                                    <button onClick={() => del(b.id)} className="p-1 text-rose-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Card>
    );
}

function DeductionSection({ employeeId, deductions, onChange, flash }: any) {
    const [concept, setConcept] = useState("");
    const [amount, setAmount] = useState("");
    const [total, setTotal] = useState("");

    const add = async () => {
        if (!concept || !amount) { flash("error", "Concepto y monto requeridos."); return; }
        const totalNum = Number(total) || null;
        const { error } = await supabase.from("employee_deductions").insert([{
            employee_id: employeeId, concept, amount_per_period: Number(amount), total_amount: totalNum, remaining_amount: totalNum, is_payroll_deduction: true, active: true,
        }]);
        if (error) { flash("error", error.message); return; }
        setConcept(""); setAmount(""); setTotal("");
        flash("success", "Deducción agregada.");
        onChange();
    };
    const del = async (id: string) => {
        if (!confirm("¿Eliminar esta deducción?")) return;
        await supabase.from("employee_deductions").delete().eq("id", id);
        onChange();
    };

    return (
        <Card title="Deducciones fijas" Icon={Minus}>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                <input value={concept} onChange={e => setConcept(e.target.value)} placeholder="Concepto (ej. Préstamo)" className="sm:col-span-2 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                <input value={amount} onChange={e => setAmount(e.target.value)} type="number" step="0.01" placeholder="Por periodo" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                <input value={total} onChange={e => setTotal(e.target.value)} type="number" step="0.01" placeholder="Total adeudado (opcional)" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <button onClick={add} className="mb-3 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> Agregar deducción</button>
            {deductions.length === 0 ? (
                <p className="text-sm text-neutral-500 text-center py-6">Sin deducciones fijas registradas.</p>
            ) : (
                <table className="w-full text-sm">
                    <thead className="text-xs text-neutral-400 uppercase tracking-wider">
                        <tr><th className="text-left py-2">Concepto</th><th className="text-right">Por periodo</th><th className="text-right">Total</th><th className="text-right">Restante</th><th></th></tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-700/50">
                        {deductions.map((d: Deduction) => (
                            <tr key={d.id}>
                                <td className="py-2 text-neutral-200">{d.concept}</td>
                                <td className="text-right font-mono text-rose-300">−{fmt(d.amount_per_period)}</td>
                                <td className="text-right font-mono text-neutral-300">{d.total_amount ? fmt(d.total_amount) : "—"}</td>
                                <td className="text-right font-mono text-neutral-300">{d.remaining_amount ? fmt(d.remaining_amount) : "—"}</td>
                                <td className="text-right">
                                    <button onClick={() => del(d.id)} className="p-1 text-rose-400 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Card>
    );
}
