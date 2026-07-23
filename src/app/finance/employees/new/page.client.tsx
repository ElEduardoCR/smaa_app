"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Save, User, AlertCircle, RefreshCw, ChevronRight, ChevronLeft, Check
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

function EmployeeForm() {
    const router = useRouter();
    const search = useSearchParams();
    const editId = search?.get("id") || null;

    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // 1) Personal
    const [code, setCode] = useState("");
    const [fullName, setFullName] = useState("");
    const [rfc, setRfc] = useState("");
    const [curp, setCurp] = useState("");
    const [nss, setNss] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState("");
    const [birthDate, setBirthDate] = useState("");
    const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
    const [position, setPosition] = useState("");
    const [department, setDepartment] = useState("");

    // 2) Pago
    const [paymentType, setPaymentType] = useState("monthly");
    const [baseSalary, setBaseSalary] = useState("");
    const [dailySalary, setDailySalary] = useState("");
    const [hourlyRate, setHourlyRate] = useState("");
    const [overtimeFactor, setOvertimeFactor] = useState("2.0");
    const [weeklyHours, setWeeklyHours] = useState("48");
    const [bankName, setBankName] = useState("");
    const [bankAccount, setBankAccount] = useState("");
    const [clabe, setClabe] = useState("");

    // 3) Fiscal
    const [isrSubsidyEligible, setIsrSubsidyEligible] = useState(true);
    const [imssModality, setImssModality] = useState("ordinario");
    const [notes, setNotes] = useState("");

    useEffect(() => {
        if (editId) {
            (async () => {
                const { data, error } = await supabase.from("payroll_employees").select("*").eq("id", editId).single();
                if (error) { setErr(error.message); return; }
                if (data) {
                    setCode(data.code || "");
                    setFullName(data.full_name || "");
                    setRfc(data.rfc || "");
                    setCurp(data.curp || "");
                    setNss(data.nss || "");
                    setEmail(data.email || "");
                    setPhone(data.phone || "");
                    setAddress(data.address || "");
                    setBirthDate(data.birth_date || "");
                    setHireDate(data.hire_date || "");
                    setPosition(data.position || "");
                    setDepartment(data.department || "");
                    setPaymentType(data.payment_type || "monthly");
                    setBaseSalary(String(data.base_salary || ""));
                    setDailySalary(String(data.daily_salary || ""));
                    setHourlyRate(String(data.hourly_rate || ""));
                    setOvertimeFactor(String(data.overtime_factor || "2.0"));
                    setWeeklyHours(String(data.weekly_hours || "48"));
                    setBankName(data.bank_name || "");
                    setBankAccount(data.bank_account || "");
                    setClabe(data.clabe || "");
                    setIsrSubsidyEligible(data.isr_subsidy_eligible ?? true);
                    setImssModality(data.imss_modality || "ordinario");
                    setNotes(data.notes || "");
                }
            })();
        } else {
            // Auto-generate next code
            (async () => {
                const { count } = await supabase.from("payroll_employees").select("id", { count: "exact", head: true });
                setCode(`EMP-${String((count || 0) + 1).padStart(4, "0")}`);
            })();
        }
    }, [editId]);

    const onSubmit = async () => {
        setBusy(true);
        setErr(null);
        try {
            if (!code.trim() || !fullName.trim() || !hireDate) {
                setErr("Faltan campos obligatorios (código, nombre, fecha de alta).");
                setBusy(false);
                return;
            }
            const payload = {
                code: code.trim(),
                full_name: fullName.trim(),
                rfc: rfc.toUpperCase().trim() || null,
                curp: curp.toUpperCase().trim() || null,
                nss: nss.trim() || null,
                email: email.trim() || null,
                phone: phone.trim() || null,
                address: address.trim() || null,
                birth_date: birthDate || null,
                hire_date: hireDate,
                position: position || null,
                department: department || null,
                payment_type: paymentType,
                base_salary: Number(baseSalary) || 0,
                daily_salary: Number(dailySalary) || 0,
                hourly_rate: Number(hourlyRate) || 0,
                overtime_factor: Number(overtimeFactor) || 2.0,
                weekly_hours: Number(weeklyHours) || 48,
                bank_name: bankName || null,
                bank_account: bankAccount || null,
                clabe: clabe || null,
                isr_subsidy_eligible: isrSubsidyEligible,
                imss_modality: imssModality,
                notes: notes || null,
                status: "active",
            };
            if (editId) {
                const { error } = await supabase.from("payroll_employees").update(payload).eq("id", editId);
                if (error) throw error;
            } else {
                const { data, error } = await supabase.from("payroll_employees").insert([payload]).select().single();
                if (error) throw error;
                router.push(`/finance/employees/${data.id}`);
                return;
            }
            router.push(`/finance/employees/${editId}`);
        } catch (e: any) {
            setErr(e?.message || "Error al guardar.");
        } finally {
            setBusy(false);
        }
    };

    const steps = [
        { num: 1, label: "Datos personales" },
        { num: 2, label: "Pago y horario" },
        { num: 3, label: "Fiscal y banco" },
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/finance/employees" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <User className="w-8 h-8 text-emerald-400" />
                            {editId ? "Editar empleado" : "Nuevo empleado"}
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">Captura la información completa. La podrás editar después.</p>
                    </div>
                </header>

                {/* Stepper */}
                <div className="flex items-center gap-2">
                    {steps.map(s => (
                        <div key={s.num} className="flex items-center gap-2 flex-1">
                            <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border",
                                step === s.num ? "bg-emerald-500 text-white border-emerald-500" :
                                step > s.num ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" :
                                "bg-neutral-800 text-neutral-500 border-neutral-700"
                            )}>
                                {step > s.num ? <Check className="w-4 h-4" /> : s.num}
                            </div>
                            <span className={cn("text-sm", step === s.num ? "text-white font-medium" : "text-neutral-500")}>{s.label}</span>
                            {s.num < steps.length && <ChevronRight className="w-4 h-4 text-neutral-600" />}
                        </div>
                    ))}
                </div>

                {err && (
                    <div className="p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" /> {err}
                    </div>
                )}

                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm space-y-4">
                    {step === 1 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">Datos personales</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Código *</label>
                                    <input value={code} onChange={e => setCode(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="text-xs text-neutral-400 ml-1">Nombre completo *</label>
                                    <input value={fullName} onChange={e => setFullName(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">RFC</label>
                                    <input value={rfc} onChange={e => setRfc(e.target.value.toUpperCase())} maxLength={13} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500" placeholder="XAXX010101000" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">CURP</label>
                                    <input value={curp} onChange={e => setCurp(e.target.value.toUpperCase())} maxLength={18} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">NSS</label>
                                    <input value={nss} onChange={e => setNss(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500" placeholder="12345678901" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Email</label>
                                    <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Teléfono</label>
                                    <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Fecha de nacimiento</label>
                                    <input value={birthDate} onChange={e => setBirthDate(e.target.value)} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Dirección</label>
                                <input value={address} onChange={e => setAddress(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Fecha de alta *</label>
                                    <input value={hireDate} onChange={e => setHireDate(e.target.value)} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Puesto</label>
                                    <input value={position} onChange={e => setPosition(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" placeholder="Ej. Operador CNC" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Departamento</label>
                                    <input value={department} onChange={e => setDepartment(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" placeholder="Ej. Producción" />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">Configuración de pago y horario</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Tipo de pago *</label>
                                    <select value={paymentType} onChange={e => setPaymentType(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                                        <option value="monthly">Mensual (sueldo fijo)</option>
                                        <option value="biweekly">Quincenal (sueldo fijo)</option>
                                        <option value="weekly">Semanal (sueldo fijo)</option>
                                        <option value="hourly">Por hora (calcula según checador)</option>
                                        <option value="daily">Diario (jornal)</option>
                                    </select>
                                    <p className="text-[10px] text-neutral-500 mt-1">
                                        {paymentType === "hourly" ? "Usa el checador para calcular las horas. Las horas extra se pagan al factor configurado." :
                                         paymentType === "monthly" ? "Sueldo fijo al mes; el checador detecta asistencia y horas extra." :
                                         "Sueldo fijo prorrateado al periodo configurado."}
                                    </p>
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Jornada semanal (horas)</label>
                                    <input value={weeklyHours} onChange={e => setWeeklyHours(e.target.value)} type="number" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {paymentType === "hourly" ? (
                                    <div>
                                        <label className="text-xs text-neutral-400 ml-1">Tarifa por hora *</label>
                                        <input value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} type="number" step="0.01" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                    </div>
                                ) : (
                                    <div>
                                        <label className="text-xs text-neutral-400 ml-1">Salario base {paymentType === "daily" ? "diario" : "mensual"} *</label>
                                        <input value={baseSalary} onChange={e => setBaseSalary(e.target.value)} type="number" step="0.01" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                    </div>
                                )}
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Salario diario (para finiquitos)</label>
                                    <input value={dailySalary} onChange={e => setDailySalary(e.target.value)} type="number" step="0.01" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" placeholder="opcional" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Factor horas extra</label>
                                    <select value={overtimeFactor} onChange={e => setOvertimeFactor(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                                        <option value="1.5">×1.5 (sencillas)</option>
                                        <option value="2.0">×2 (dobles)</option>
                                        <option value="3.0">×3 (triples)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Banco</label>
                                    <input value={bankName} onChange={e => setBankName(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Cuenta</label>
                                    <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">CLABE interbancaria (18 dígitos)</label>
                                    <input value={clabe} onChange={e => setClabe(e.target.value)} maxLength={18} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">Configuración fiscal</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Modalidad IMSS</label>
                                    <select value={imssModality} onChange={e => setImssModality(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                                        <option value="ordinario">Trabajador ordinario</option>
                                        <option value="domestico">Trabajador doméstico</option>
                                        <option value="out">Outsourcing</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2 pt-5">
                                    <input type="checkbox" id="subsidy" checked={isrSubsidyEligible} onChange={e => setIsrSubsidyEligible(e.target.checked)} className="w-4 h-4 rounded border-neutral-600 bg-neutral-900 text-emerald-500" />
                                    <label htmlFor="subsidy" className="text-sm text-neutral-300">Aplica subsidio al empleo</label>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Notas</label>
                                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 min-h-[80px]" />
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-between">
                    <button
                        type="button"
                        onClick={() => setStep(s => Math.max(1, s - 1))}
                        disabled={step === 1}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors text-sm font-medium disabled:opacity-30"
                    >
                        <ChevronLeft className="w-4 h-4" /> Atrás
                    </button>
                    {step < 3 ? (
                        <button
                            type="button"
                            onClick={() => setStep(s => Math.min(3, s + 1))}
                            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm"
                        >
                            Siguiente <ChevronRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={busy}
                            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                        >
                            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {editId ? "Guardar cambios" : "Crear empleado"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function NewEmployeePage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-emerald-400" /></div>}>
            <EmployeeForm />
        </Suspense>
    );
}
