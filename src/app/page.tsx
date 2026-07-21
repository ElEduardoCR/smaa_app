"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Users, Server, LogOut, BarChart3, Receipt, ShieldCheck, Cog, Flame, Cpu } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { useRouter } from "next/navigation";

export default function Home() {
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'connected' | 'failed'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function checkConnection() {
      try {
        const { error } = await supabase.from('clients').select('id').limit(1);

        if (error) {
          console.error("Supabase Connection Error:", error);
          setErrorMessage(error.message);
          setConnectionStatus('failed');
        } else {
          setConnectionStatus('connected');
        }
      } catch (err: any) {
        console.error("Unexpected Supabase Error:", err);
        setErrorMessage(err.message || 'Unknown error');
        setConnectionStatus('failed');
      }
    }

    checkConnection();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(249,115,22,0.3),rgba(255,255,255,0))] flex flex-col items-center p-8 font-[family-name:var(--font-sans)]">
      <main className="flex flex-col gap-10 max-w-5xl w-full z-10 pt-10">
        <header className="flex flex-col md:flex-row justify-between items-center gap-6 pb-8 border-b border-orange-500/10">
          <div className="flex w-full justify-between items-start md:w-auto md:block">
            <div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-2 bg-clip-text text-transparent bg-gradient-to-r from-orange-100 to-orange-500">
                SMAA ERP
              </h1>
              <p className="text-orange-200/60 font-medium">Enterprise Resource Planning System</p>
            </div>
            <button
              onClick={async () => {
                await logoutAction();
                window.location.href = '/login';
              }}
              className="md:hidden flex items-center justify-center p-2 rounded-xl bg-neutral-800/50 hover:bg-neutral-700/80 border border-neutral-700/50 text-neutral-300 transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="w-5 h-5 text-rose-400" />
            </button>
          </div>

          <div className="flex gap-4">
            <div className="flex bg-neutral-800/50 backdrop-blur-md rounded-2xl p-4 border border-neutral-700/50 min-w-64 max-w-sm">
              <div className="flex gap-4 items-center w-full">
                <div className="bg-orange-500/20 p-3 rounded-xl">
                  <Server className="w-5 h-5 text-orange-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-neutral-400 font-semibold mb-1 uppercase tracking-wider">Database Status</p>
                  {connectionStatus === 'loading' && (
                    <div className="text-orange-400 font-medium flex items-center gap-2 text-sm">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                      </span>
                      Connecting...
                    </div>
                  )}

                  {connectionStatus === 'connected' && (
                    <div className="text-emerald-400 font-medium flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                      Operational
                    </div>
                  )}

                  {connectionStatus === 'failed' && (
                    <div className="flex flex-col">
                      <div className="text-red-400 font-medium flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        Disconnected
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                await logoutAction();
                window.location.href = '/login';
              }}
              className="hidden md:flex flex-col items-center justify-center px-4 rounded-2xl bg-neutral-800/50 hover:bg-neutral-700/80 border border-neutral-700/50 text-neutral-300 transition-colors group"
              title="Cerrar sesión"
            >
              <LogOut className="w-6 h-6 text-neutral-400 group-hover:text-rose-400 mb-1 transition-colors" />
              <span className="text-xs font-medium">Salir</span>
            </button>
          </div>
        </header>

        <section>
          <h2 className="text-2xl font-semibold mb-6 text-neutral-200">Modules</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">

            <Link href="/dashboard" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-orange-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-orange-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-orange-500/20 to-orange-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <BarChart3 className="w-7 h-7 text-orange-400 group-hover:text-orange-300" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Dashboard</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Estadísticas del negocio: gasto en compras por año y por mes.
                </p>
                <div className="mt-6 font-medium text-sm text-orange-400 flex items-center group-hover:text-orange-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/clients" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-orange-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-orange-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-orange-500/20 to-orange-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Users className="w-7 h-7 text-orange-400 group-hover:text-orange-300" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Clientes</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Manage CFDI 4.0 compliant client records, RFCs, and fiscal regimes.
                </p>
                <div className="mt-6 font-medium text-sm text-orange-400 flex items-center group-hover:text-orange-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/sales" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-emerald-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-emerald-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7 text-emerald-400 group-hover:text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Ventas</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Create and manage quotations, auto-calculate IVA, and export PDFs.
                </p>
                <div className="mt-6 font-medium text-sm text-emerald-400 flex items-center group-hover:text-emerald-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/settings" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-amber-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-amber-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7 text-amber-400 group-hover:text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Configuración</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Manage your company profile, logo, and PDF export details.
                </p>
                <div className="mt-6 font-medium text-sm text-amber-400 flex items-center group-hover:text-amber-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/manufacturing" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-orange-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-orange-500/10 group-hover:-translate-y-1">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-12 h-12 bg-gradient-to-br from-orange-500/20 to-orange-500/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <Cog className="w-6 h-6 text-orange-400 group-hover:text-orange-300" />
                  </div>
                  <div className="w-12 h-12 bg-gradient-to-br from-amber-500/20 to-amber-500/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <Flame className="w-6 h-6 text-amber-400 group-hover:text-amber-300" />
                  </div>
                  <div className="w-12 h-12 bg-gradient-to-br from-cyan-500/20 to-cyan-500/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <Cpu className="w-6 h-6 text-cyan-400 group-hover:text-cyan-300" />
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Fabricación</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Maquinado, Soldadura y Automatización. OTs con WPS, archivos, visor PDF y 3D integrado.
                </p>
                <div className="mt-6 font-medium text-sm text-orange-400 flex items-center group-hover:text-orange-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/quality" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-sky-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-sky-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-sky-500/20 to-sky-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <ShieldCheck className="w-7 h-7 text-sky-400 group-hover:text-sky-300" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Calidad</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Cola de OTs esperando revisión final y liberación por Calidad.
                </p>
                <div className="mt-6 font-medium text-sm text-sky-400 flex items-center group-hover:text-sky-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/suppliers" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-rose-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-rose-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-rose-500/20 to-orange-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7 text-rose-400 group-hover:text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Proveedores</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Alta, edición y eliminación de proveedores con datos fiscales.
                </p>
                <div className="mt-6 font-medium text-sm text-rose-400 flex items-center group-hover:text-rose-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/purchases" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-orange-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-orange-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-orange-500/20 to-orange-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7 text-orange-400 group-hover:text-orange-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Compras</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Órdenes de compra, cotizaciones de proveedores y PDF de POs.
                </p>
                <div className="mt-6 font-medium text-sm text-orange-400 flex items-center group-hover:text-orange-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/issued-invoices" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-teal-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-teal-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-teal-500/20 to-emerald-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Receipt className="w-7 h-7 text-teal-400 group-hover:text-teal-300" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Facturas Emitidas</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Importa y consulta los CFDI que tu negocio ha emitido a clientes.
                </p>
                <div className="mt-6 font-medium text-sm text-teal-400 flex items-center group-hover:text-teal-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

            <Link href="/deliveries" className="block group">
              <div className="bg-neutral-800/40 border border-neutral-700/50 hover:border-emerald-500/50 hover:bg-neutral-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-emerald-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-7 h-7 text-emerald-400 group-hover:text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Entregas</h3>
                <p className="text-neutral-400 text-sm flex-1 leading-relaxed">
                  Notas de entrega de OTs terminadas con folio NE y datos de envío.
                </p>
                <div className="mt-6 font-medium text-sm text-emerald-400 flex items-center group-hover:text-emerald-300">
                  Open Module
                  <svg className="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </Link>

          </div>
        </section>
      </main>
    </div>
  );
}
