"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/app/components/Toast";
import { formatINR } from "@/lib/money";

const navItems = [
  { icon: "dashboard", label: "Dashboard", href: "/dashboard" },
  { icon: "sync_alt", label: "Transfers", href: "/transfers" },
  { icon: "account_balance_wallet", label: "Wealth", href: "/fixed-deposits" },
  { icon: "monitoring", label: "Investments", href: "/investments" },
  { icon: "credit_card", label: "Cards", href: "/cards" },
  { icon: "account_balance", label: "Loans", href: "/loans" },
  { icon: "history", label: "Transactions", href: "/transactions" },
  { icon: "person", label: "Profile", href: "/profile" },
];

export default function CustomerLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userToken, setUserToken] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  // ── Get auth token ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace("/"); return; }
      const token = await user.getIdToken();
      setUserToken(token);
    });
    return unsub;
  }, [router]);

  // ── Fetch user profile ──
  useEffect(() => {
    if (!userToken) return;
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${userToken}` } })
      .then((r) => r.json())
      .then((data) => { if (data.uid) setUserProfile(data); })
      .catch(() => {});
  }, [userToken]);

  // ── Fetch recent transactions as notifications ──
  useEffect(() => {
    if (!userToken) return;
    fetch("/api/transactions", { headers: { Authorization: `Bearer ${userToken}` } })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setNotifications(data.slice(0, 5)); })
      .catch(() => {});
  }, [userToken]);

  // ── DACIS security check ──
  useEffect(() => {
    if (!userToken || pathname === "/dacis/frozen") return;
    fetch("/api/dacis/check", { headers: { Authorization: `Bearer ${userToken}` } })
      .then((r) => r.json())
      .then((data) => { if (data.flagged) router.replace("/dacis/frozen"); })
      .catch(() => {});
  }, [userToken, pathname, router]);

  // Close sidebar on route change
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Close on outside click (sidebar)
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (e) => {
      if (!e.target.closest("#glass-sidebar") && !e.target.closest("#sidebar-toggle")) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sidebarOpen]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifications(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfile(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem("nb_token");
      toast.success("Logged out successfully");
      router.replace("/");
    } catch {
      toast.error("Logout failed");
    }
  };

  const userName = userProfile?.name || auth.currentUser?.displayName || "User";
  const userTier = userProfile?.tier || "Standard";
  const userEmail = userProfile?.email || auth.currentUser?.email || "";
  const initials = userName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen bg-void-black">
      {/* ── Top Bar (always visible) ── */}
      <header className="fixed top-0 w-full z-50 flex items-center justify-between px-margin-mobile md:px-margin-desktop h-16 bg-surface-container-lowest/60 backdrop-blur-xl border-b border-white/5">
        {/* Logo / Toggle */}
        <button
          id="sidebar-toggle"
          onClick={() => setSidebarOpen((o) => !o)}
          className="flex items-center gap-3 group cursor-pointer select-none"
          aria-label="Toggle sidebar"
        >
          <span
            className="material-symbols-outlined text-[32px] text-electric-blue transition-transform duration-300 group-hover:scale-110"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            neurology
          </span>
          <span className="text-headline-md font-bold text-primary hidden sm:block">NeuroBank</span>
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => { setShowNotifications((o) => !o); setShowProfile(false); }}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-2 rounded-lg hover:bg-surface-container-high relative"
            >
              <span className="material-symbols-outlined">notifications</span>
              {notifications.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-electric-blue shadow-[0_0_6px_rgba(255,107,0,0.8)]" />
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-12 w-80 glass-modal rounded-xl overflow-hidden shadow-2xl z-50">
                <div className="p-4 border-b border-white/5 flex justify-between items-center">
                  <span className="text-label-md text-on-surface uppercase">Notifications</span>
                  <button onClick={() => router.push("/transactions")} className="text-label-sm text-electric-blue hover:text-primary transition-colors">View All</button>
                </div>
                <div className="max-h-64 overflow-y-auto custom-scroll">
                  {notifications.length === 0 ? (
                    <div className="p-6 text-center text-on-surface-variant text-label-sm">No recent activity</div>
                  ) : (
                    notifications.map((txn, i) => (
                      <div
                        key={txn.id || i}
                        className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer border-b border-white/5 last:border-0"
                        onClick={() => { setShowNotifications(false); router.push("/transactions"); }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center">
                            <span className={`material-symbols-outlined text-[16px] ${txn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>{txn.icon || "receipt"}</span>
                          </div>
                          <div>
                            <p className="text-body-md text-on-surface text-[13px]">{txn.name}</p>
                            <p className="text-[10px] text-on-surface-variant">{txn.category}</p>
                          </div>
                        </div>
                        <span className={`text-label-sm font-mono ${txn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>
                          {txn.amount > 0 ? "+" : ""}{formatINR(Math.abs(txn.amount))}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => { setShowProfile((o) => !o); setShowNotifications(false); }}
              className="w-9 h-9 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center cursor-pointer hover:border-electric-blue/50 transition-colors"
            >
              <span className="text-label-sm text-primary font-bold">{initials}</span>
            </button>

            {showProfile && (
              <div className="absolute right-0 top-12 w-64 glass-modal rounded-xl overflow-hidden shadow-2xl z-50">
                <div className="p-4 border-b border-white/5">
                  <p className="text-body-md text-on-surface font-medium">{userName}</p>
                  <p className="text-label-sm text-on-surface-variant truncate">{userEmail}</p>
                  <span className="inline-block mt-2 text-label-sm text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">{userTier}</span>
                </div>
                <div className="p-2">
                    <button
                      onClick={() => { setShowProfile(false); router.push("/profile"); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all duration-200 rounded-lg text-left"
                    >
                      <span className="material-symbols-outlined text-[20px]">person</span>
                      <span className="text-label-md">View Profile</span>
                    </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:text-error hover:bg-error/5 transition-all duration-200 rounded-lg text-left"
                  >
                    <span className="material-symbols-outlined text-[20px]">logout</span>
                    <span className="text-label-md">Logout</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Glassmorphism Sidebar Overlay ── */}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-void-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      {/* Sidebar Panel */}
      <nav
        id="glass-sidebar"
        className={`fixed left-4 top-20 z-50 flex flex-col h-[calc(100vh-6rem)] w-[272px] rounded-2xl sidebar-glass py-6 px-4 gap-2 transition-all duration-300 ease-out ${
          sidebarOpen
            ? "opacity-100 translate-x-0 pointer-events-auto"
            : "opacity-0 -translate-x-6 pointer-events-none"
        }`}
      >
        {/* Top edge highlight */}
        <div className="absolute top-0 left-6 right-6 h-[1px] bg-gradient-to-r from-transparent via-electric-blue/50 to-transparent rounded-full" />

        {/* User Card */}
        <div className="flex items-center gap-3 p-4 mb-4 rounded-xl bg-white/5 border border-white/10">
          <div className="w-11 h-11 rounded-full bg-surface-container-high border-2 border-electric-blue/60 flex items-center justify-center shrink-0">
            <span className="text-label-md text-primary font-bold">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="text-body-md font-semibold text-on-surface truncate">{userName}</p>
            <p className="text-label-sm text-on-surface-variant">{userTier} Member</p>
          </div>
          <span className="ml-auto w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_#4ade80] shrink-0" />
        </div>

        {/* Nav Items */}
        <div className="flex flex-col gap-1 flex-grow overflow-y-auto custom-scroll">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  isActive
                    ? "bg-electric-blue/20 text-pure-white border border-electric-blue/30 shadow-[0_0_12px_rgba(255,107,0,0.2)]"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-white/5"
                }`}
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
                >
                  {item.icon}
                </span>
                <span className="text-label-md">{item.label}</span>
                {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-electric-blue shadow-[0_0_6px_rgba(255,107,0,0.8)]" />}
              </Link>
            );
          })}
        </div>

        {/* Divider */}
        <div className="h-[1px] bg-white/10 mx-2 my-2" />

        {/* Logout */}
        <div className="flex flex-col gap-1">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:text-error hover:bg-error/5 transition-all duration-200 rounded-xl w-full text-left"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="text-label-md">Logout</span>
          </button>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <main className="flex-1 pt-16 px-margin-mobile md:px-margin-desktop min-h-screen overflow-y-auto custom-scroll relative bg-background">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-electric-blue/10 blur-[120px] rounded-full pointer-events-none z-0" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/10 blur-[120px] rounded-full pointer-events-none z-0" />
        <div className="relative z-10 py-8 pb-24 md:pb-margin-desktop">
          {children}
        </div>
      </main>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex items-center justify-around px-2 py-3 bg-surface/90 backdrop-blur-xl border-t border-outline-variant shadow-lg h-16">
        {[
          { icon: "dashboard", label: "Dash", href: "/dashboard" },
          { icon: "sync_alt", label: "Txns", href: "/transfers" },
          { icon: "monitoring", label: "Invest", href: "/investments" },
          { icon: "person", label: "Profile", href: "/profile" },
        ].map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 ${
                isActive ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              <span
                className="material-symbols-outlined"
                style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
              >
                {item.icon}
              </span>
              <span className="text-[10px] text-label-sm">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
