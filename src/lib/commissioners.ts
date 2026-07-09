import { supabase } from "@/lib/supabase";

// Un comisionado = agente de ventas especial que se lleva parte de la venta.
// Solo guardamos su nombre y el monto que le toca (calculado manualmente por el
// usuario). Es información INTERNA: no se imprime en el PDF del cliente.
export type Commissioner = { name: string; amount: number };

export const emptyCommissioner: Commissioner = { name: "", amount: 0 };

// Limpia lo que venga del formulario / base de datos a un arreglo tipado,
// descartando filas totalmente vacías.
export function normalizeCommissioners(raw: unknown): Commissioner[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((c: any) => ({
            name: typeof c?.name === "string" ? c.name.trim() : "",
            amount: Number(c?.amount) || 0,
        }))
        .filter((c) => c.name !== "" || c.amount !== 0);
}

export function commissionersTotal(list: { amount?: number | null }[] | null | undefined): number {
    return (list || []).reduce((acc, c) => acc + (Number(c?.amount) || 0), 0);
}

// Nombres de comisionados usados anteriormente (para el datalist del formulario).
// Falla en silencio: la cotización debe poder guardarse aunque el catálogo no
// esté disponible.
export async function fetchCommissionAgentNames(): Promise<string[]> {
    try {
        const { data, error } = await supabase
            .from("commission_agents")
            .select("name")
            .order("name", { ascending: true });
        if (error) throw error;
        return (data || []).map((r: any) => r.name).filter(Boolean);
    } catch (e) {
        console.warn("Could not load commission agents", e);
        return [];
    }
}

// Recuerda los nombres de comisionados nuevos para reusarlos después.
// No bloquea el guardado de la cotización si falla.
export async function rememberCommissionAgents(names: string[]): Promise<void> {
    const clean = Array.from(
        new Set(names.map((n) => (n || "").trim()).filter(Boolean))
    );
    if (clean.length === 0) return;
    try {
        await supabase
            .from("commission_agents")
            .upsert(
                clean.map((name) => ({ name })),
                { onConflict: "name", ignoreDuplicates: true }
            );
    } catch (e) {
        console.warn("Could not remember commission agents", e);
    }
}
