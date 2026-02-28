import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col items-center justify-center p-8 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 items-center max-w-2xl w-full z-10 relative">
        <div className="absolute inset-0 bg-blue-500/10 blur-[100px] rounded-full -z-10 animate-pulse hidden sm:block pointer-events-none" />

        <div className="glass-panel p-10 sm:p-14 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl flex flex-col items-center text-center w-full transition-all duration-500 hover:border-white/20 hover:bg-white/10 group">
          <div className="h-24 w-24 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform duration-300">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-white mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
            Voxa ERP Running
          </h1>

          <p className="text-lg text-slate-300 mb-8 max-w-md mx-auto font-light">
            Enterprise Resource Planning system is online and ready. The infrastructure has been successfully initialized.
          </p>

          <div className="flex gap-4 items-center flex-col sm:flex-row w-full justify-center">
            <div className="px-6 py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium flex items-center gap-2 text-sm shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              System Operational
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
