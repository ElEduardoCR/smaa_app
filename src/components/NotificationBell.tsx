"use client";

// ===========================================================================
// Campana de notificaciones del menú. Un solo proveedor consulta los avisos
// (cada minuto y al volver a la pestaña) y lo comparten el botón del menú
// lateral y el de la barra superior en móvil.
// ===========================================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck, X, BellRing } from "lucide-react";
import {
    getNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction, type NotificationItem,
} from "@/app/actions/notifications";

const POLL_MS = 60_000;
const DESKTOP_KEY = "smaa-desktop-notifs";

type Ctx = { unread: number; open: boolean; toggle: () => void };
const NotificationsContext = createContext<Ctx>({ unread: 0, open: false, toggle: () => {} });

export function timeAgo(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "hace un momento";
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
    return new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" });
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [unread, setUnread] = useState(0);
    const [open, setOpen] = useState(false);
    const [desktop, setDesktop] = useState(() => {
        if (typeof window === "undefined") return false;
        try { return localStorage.getItem(DESKTOP_KEY) === "1"; } catch { return false; }
    });
    const lastSeen = useRef<number | null>(null);

    const load = useCallback(async () => {
        try {
            const summary = await getNotificationsAction({ limit: 15 });
            setItems(summary.items);
            setUnread(summary.unread);
            const newest = summary.items[0]?.id ?? 0;
            // Aviso del sistema operativo sólo para lo que llegó desde la última consulta.
            if (lastSeen.current !== null && desktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
                summary.items.filter((n) => n.id > lastSeen.current! && !n.read).slice(0, 3).forEach((n) => {
                    const notice = new Notification(n.title, { body: n.body || undefined, tag: `smaa-${n.id}` });
                    notice.onclick = () => { window.focus(); if (n.link) router.push(n.link); };
                });
            }
            lastSeen.current = Math.max(lastSeen.current ?? 0, newest);
        } catch {
            // Sin sesión o sin red: se reintenta en la siguiente vuelta.
        }
    }, [desktop, router]);

    useEffect(() => {
        const first = setTimeout(load, 0);
        const timer = setInterval(load, POLL_MS);
        const onFocus = () => load();
        window.addEventListener("focus", onFocus);
        return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", onFocus); };
    }, [load]);

    const openItem = async (n: NotificationItem) => {
        setOpen(false);
        if (!n.read) {
            setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
            setUnread((u) => Math.max(u - 1, 0));
            markNotificationReadAction(n.id).catch(() => {});
        }
        if (n.link) router.push(n.link);
    };
    const markAll = async () => {
        await markAllNotificationsReadAction().catch(() => {});
        setItems((list) => list.map((x) => ({ ...x, read: true })));
        setUnread(0);
    };
    const enableDesktop = async () => {
        if (typeof Notification === "undefined") return;
        const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        const enabled = permission === "granted" ? !desktop : false;
        setDesktop(enabled);
        try { localStorage.setItem(DESKTOP_KEY, enabled ? "1" : "0"); } catch { /* modo privado */ }
    };

    return (
        <NotificationsContext.Provider value={{ unread, open, toggle: () => { setOpen((o) => !o); if (!open) load(); } }}>
            {children}
            {open && (
                <>
                    <div className="app-notif-scrim" onClick={() => setOpen(false)} />
                    <div className="app-notif-panel" role="dialog" aria-label="Notificaciones">
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-700/60">
                            <p className="text-sm font-semibold text-white flex items-center gap-2"><Bell className="w-4 h-4" /> Notificaciones {unread > 0 && <span className="text-xs text-rose-300">({unread} sin leer)</span>}</p>
                            <div className="flex items-center gap-1">
                                {unread > 0 && <button onClick={markAll} className="text-xs text-sky-300 hover:text-white px-2 py-1 rounded flex items-center gap-1"><CheckCheck className="w-3.5 h-3.5" /> Marcar leídas</button>}
                                <button onClick={() => setOpen(false)} className="p-1 text-neutral-400 hover:text-white" aria-label="Cerrar"><X className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <ul className="flex-1 overflow-y-auto divide-y divide-neutral-800/70">
                            {items.length === 0 && <li className="p-6 text-center text-sm text-neutral-500">Sin notificaciones por ahora.</li>}
                            {items.map((n) => (
                                <li key={n.id}>
                                    <button onClick={() => openItem(n)} className="w-full text-left px-4 py-3 hover:bg-neutral-800/60 flex gap-3">
                                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-rose-500"}`} />
                                        <span className="min-w-0">
                                            <span className={`block text-sm ${n.read ? "text-neutral-300" : "text-white font-semibold"}`}>{n.title}</span>
                                            {n.body && <span className="block text-xs text-neutral-400 truncate">{n.body}</span>}
                                            <span className="block text-[11px] text-neutral-500 mt-0.5">{n.actorName ? `${n.actorName} · ` : ""}{timeAgo(n.createdAt)}{n.personal ? " · para ti" : ""}</span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-neutral-700/60 text-xs">
                            <Link href="/notifications" onClick={() => setOpen(false)} className="text-sky-300 hover:text-white">Ver todas</Link>
                            <button onClick={enableDesktop} className="text-neutral-400 hover:text-white flex items-center gap-1" title="Mostrar avisos del sistema aunque estés en otra pestaña">
                                <BellRing className="w-3.5 h-3.5" /> Avisos de escritorio: {desktop ? "activados" : "desactivados"}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </NotificationsContext.Provider>
    );
}

export function NotificationBellButton() {
    const { unread, toggle } = useContext(NotificationsContext);
    return (
        <button type="button" className="app-icon-btn app-bell" onClick={toggle}
            title={unread ? `${unread} notificación(es) sin leer` : "Notificaciones"} aria-label="Notificaciones">
            <Bell />
            {unread > 0 && <span className="app-bell-count">{unread > 99 ? "99+" : unread}</span>}
        </button>
    );
}
