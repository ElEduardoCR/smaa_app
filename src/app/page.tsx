"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Users, Server } from "lucide-react";

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
    <div className="min-h-screen bg-[#0B1120] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))] flex flex-col items-center p-8 font-[family-name:var(--font-sans)]">
      <main className="flex flex-col gap-10 max-w-5xl w-full z-10 pt-10">
        <header className="flex flex-col md:flex-row justify-between items-center gap-6 pb-8 border-b border-indigo-500/10">
          <div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-2 bg-clip-text text-transparent bg-gradient-to-r from-indigo-100 to-indigo-500">
              Voxa ERP
            </h1>
            <p className="text-indigo-200/60 font-medium">Enterprise Resource Planning System</p>
          </div>

          <div className="flex bg-slate-800/50 backdrop-blur-md rounded-2xl p-4 border border-slate-700/50 min-w-64 max-w-sm">
            <div className="flex gap-4 items-center w-full">
              <div className="bg-indigo-500/20 p-3 rounded-xl">
                <Server className="w-5 h-5 text-indigo-400" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-slate-400 font-semibold mb-1 uppercase tracking-wider">Database Status</p>
                {connectionStatus === 'loading' && (
                  <div className="text-blue-400 font-medium flex items-center gap-2 text-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
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
        </header>

        <section>
          <h2 className="text-2xl font-semibold mb-6 text-slate-200">Modules</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">

            <Link href="/clients" className="block group">
              <div className="bg-slate-800/40 border border-slate-700/50 hover:border-indigo-500/50 hover:bg-slate-800/80 transition-all duration-300 rounded-3xl p-6 h-full flex flex-col shadow-lg shadow-black/20 hover:shadow-indigo-500/10 group-hover:-translate-y-1">
                <div className="w-14 h-14 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Users className="w-7 h-7 text-indigo-400 group-hover:text-indigo-300" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Clients</h3>
                <p className="text-slate-400 text-sm flex-1 leading-relaxed">
                  Manage CFDI 4.0 compliant client records, RFCs, and fiscal regimes.
                </p>
                <div className="mt-6 font-medium text-sm text-indigo-400 flex items-center group-hover:text-indigo-300">
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
