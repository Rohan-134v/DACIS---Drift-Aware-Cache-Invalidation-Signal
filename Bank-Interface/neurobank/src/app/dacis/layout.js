import Link from "next/link";

export default function DacisLayout({ children }) {
  return (
    <div className="min-h-screen bg-void-black text-on-surface antialiased flex items-center justify-center relative">
      {/* Ambient Background */}
      <div className="absolute inset-0 bg-surface-container-lowest z-0"></div>
      <div className="absolute inset-0 bg-grid z-0 pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-error/5 rounded-full blur-[100px] pointer-events-none z-0"></div>
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent z-0 opacity-50"></div>

      {/* Top Bar */}
      <nav className="fixed top-0 left-0 w-full z-50 flex items-center justify-between px-margin-mobile md:px-margin-desktop py-4 bg-surface/60 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-error" style={{ fontVariationSettings: "'FILL' 1" }}>gpp_maybe</span>
          <span className="text-headline-md font-bold text-primary">DACIS Security</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-label-md text-on-surface-variant hover:text-pure-white transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Return to Bank
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main className="relative z-10 w-full max-w-4xl px-gutter py-24 flex flex-col items-center">
        {children}
      </main>
    </div>
  );
}
