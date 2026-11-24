"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, CheckCheck, RefreshCw } from "lucide-react";
import {
    getNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, type NotificationItem,
} from "@/app/actions/notifications";
import { timeAgo } from "@/components/NotificationBell";

const MODULE_LABEL: Record<string, string> = {
    requisitions: "Requisiciones", manufacturing: "Fabricación", quality: "Calidad", deliveries: "Entregas",
    documents: "Documentos", document_requests: "Req. de documentos", purchases: "Compras", sales: "Ventas",
    finance: "Cuentas por cobrar", vehicles: "Vehículos",
};

export default function NotificationsClient() {
    const router = useRouter();
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(true);
    const [more, setMore] = useState(true);
    const [filter, setFilter] = useState("all");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const summary = await getNotificationsAction({ limit: 50 });
            setItems(summary.items);
            setUnread(summary.unread);
            setMore(summary.items.length === 50);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const loadMore = async () => {
        const last = items[items.length - 1];
        if (!last) return;
        const summary = await getNotificationsAction({ limit: 50, beforeId: last.id });
        setItems((list) => [...list, ...summary.items]);
        setMore(summary.items.length === 50);
    };
    const open = (n: NotificationItem) => {
        if (!n.read) markNotificationReadAction(n.id).catch(() => {});
        if (n.link) router.push(n.link);
        else setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    };
    const markAll = async () => {
        await markAllNotificationsReadAction();
        setItems((list) => list.map((x) => ({ ...x, read: true })));
        setUnread(0);
    };
    const modules = useMemo(() => Array.from(new Set(items.map((i) => i.moduleCode))), [items]);
    const visible = items.filter((i) => filter === "all" || (filter === "unread" ? !i.read : i.moduleCode === filter));

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10">
            <div className="max-w-3xl mx-auto space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Bell className="w-8 h-8 text-rose-400" /> Notificaciones</h1>
                            <p className="text-neutral-400 text-sm mt-1">Requisiciones, OT, Calidad, documentos, compras y vehículos de los módulos que tienes asignados.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg" title="Actualizar"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
                        {unread > 0 && <button onClick={markAll} className="text-sm text-sky-300 border border-sky-500/30 px-3 py-2 rounded-lg flex items-center gap-1.5"><CheckCheck className="w-4 h-4" /> Marcar todas como leídas</button>}
                    </div>
                </header>

                <div className="flex flex-wrap gap-2">
                    {["all", "unread", ...modules].map((value) => (
                        <button key={value} onClick={() => setFilter(value)} className={`text-xs px-3 py-1.5 rounded-full border ${filter === value ? "bg-white/10 text-white border-white/20" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50"}`}>
                            {value === "all" ? "Todas" : value === "unread" ? `Sin leer (${unread})` : MODULE_LABEL[value] || value}
                        </button>
                    ))}
                </div>

                <ul className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl divide-y divide-neutral-700/50 overflow-hidden">
                    {!loading && visible.length === 0 && <li className="p-10 text-center text-neutral-500">Sin notificaciones.</li>}
                    {visible.map((n) => (
                        <li key={n.id}>
                            <button onClick={() => open(n)} className="w-full text-left p-4 hover:bg-neutral-800/60 flex gap-3">
                                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? "bg-neutral-700" : "bg-rose-500"}`} />
                                <span className="min-w-0 flex-1">
                                    <span className={`block text-sm ${n.read ? "text-neutral-300" : "text-white font-semibold"}`}>{n.title}</span>
                                    {n.body && <span className="block text-xs text-neutral-400 mt-0.5">{n.body}</span>}
                                    <span className="block text-[11px] text-neutral-500 mt-1">{MODULE_LABEL[n.moduleCode] || n.moduleCode} · {n.actorName ? `${n.actorName} · ` : ""}{timeAgo(n.createdAt)}{n.personal ? " · para ti" : ""}</span>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
                {more && !loading && items.length > 0 && <button onClick={loadMore} className="w-full text-sm text-neutral-300 border border-neutral-700 rounded-xl py-2.5 hover:bg-neutral-800">Cargar anteriores</button>}
            </div>
        </div>
    );
}
