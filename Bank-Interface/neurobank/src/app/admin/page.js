"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

/* ─── Stat Card ─── */
function StatCard({ icon, label, value, sub, color = "text-electric-blue" }) {
  return (
    <div className="glass-stat p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className={`material-symbols-outlined ${color}`} style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
        <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-headline-lg ${color} glow-text`}>{value ?? "—"}</p>
      {sub && <p className="text-label-sm text-on-surface-variant">{sub}</p>}
    </div>
  );
}

/* ─── Admin Page ─── */
export default function AdminPage() {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  
  const [cards, setCards] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [fixedDeposits, setFixedDeposits] = useState([]);
  const [settings, setSettings] = useState({ loanPaymentIntervalDays: 30, fdDefaultTermMonths: 12, cardExpiryYears: 3 });
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loans, setLoans] = useState([]);
  const [loanActionLoading, setLoanActionLoading] = useState({});
  const [fdActionLoading, setFdActionLoading] = useState({});
  const [accountForm, setAccountForm] = useState({ name: "", email: "", password: "" });
  const [accountMessage, setAccountMessage] = useState("");
  const [createdAccountInfo, setCreatedAccountInfo] = useState(null);
  const [creditUid, setCreditUid] = useState("");
  const [creditAmount, setCreditAmount] = useState(0);
  const [dacisTargetUid, setDacisTargetUid] = useState("");
  const [dacisReason, setDacisReason] = useState("manual_flag");

  // ── DACIS Engine Live Telemetry State ──
  const [dacisHealth, setDacisHealth] = useState(null);
  const [dacisCacheStats, setDacisCacheStats] = useState(null);
  const [dacisLiveFeed, setDacisLiveFeed] = useState([]);
  const [dacisWsConnected, setDacisWsConnected] = useState(false);
  const [burstRingSize, setBurstRingSize] = useState(6);
  const [burstLength, setBurstLength] = useState(40);
  const [burstLoading, setBurstLoading] = useState(false);
  const [burstResults, setBurstResults] = useState(null);
  const dacisWsRef = useRef(null);
  const liveFeedRef = useRef(null);

  // ── Auth guard: must be logged in with admin role ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setNeedsLogin(true);
        setToken(null);
        setAuthChecked(true);
        setLoading(false);
        return;
      }
      setNeedsLogin(false);
      try {
        const t = await user.getIdToken();
        const [result, profile] = await Promise.all([
          user.getIdTokenResult(),
          fetch("/api/auth/me", { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.ok ? r.json() : null).catch(() => null),
        ]);
        const claimRole = result?.claims?.role;
        const profileRole = profile?.role;
        const isAdmin = claimRole === "admin" || profileRole === "admin";
        const hasDefinitiveProfile = claimRole || profileRole;
        if (!isAdmin && hasDefinitiveProfile) {
          setLoading(false);
          router.replace("/dashboard");
          return;
        }
        if (!isAdmin) {
          setNeedsLogin(true);
          setLoading(false);
          setAuthChecked(true);
          return;
        }
        setToken(t);
        setAuthChecked(true);
      } catch (err) {
        setNeedsLogin(true);
        setToken(null);
        setAuthChecked(true);
        setLoading(false);
      }
    });
    return unsub;
  }, [router]);

  const apiFetch = useCallback(
    (path, opts = {}) => fetch(path, { headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }, ...opts }).then((r) => r.json()),
    [token]
  );

  const saveSettings = async (newSettings) => {
    setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(newSettings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save settings.");
      setSettings(newSettings);
    } catch (err) {
      setError(err.message || "Failed to save settings.");
    }
  };

  // ── Load data once auth is confirmed ──
  useEffect(() => {
    if (!authChecked || !token) return;
    setLoading(true);
    Promise.all([
      apiFetch("/api/admin/stats"),
      apiFetch("/api/admin/users"),
      apiFetch("/api/admin/loans"),
      apiFetch("/api/admin/security-incidents"),
      apiFetch("/api/admin/fixed-deposits"),
      apiFetch("/api/admin/cards"),
      apiFetch("/api/admin/settings"),
    ])
      .then(([s, u, l, i, f, c, set]) => {
        setStats(s);
        setUsers(u);
        setLoans(Array.isArray(l) ? l : []);
        setIncidents(Array.isArray(i) ? i : []);
        setFixedDeposits(Array.isArray(f) ? f : []);
        setCards(Array.isArray(c) ? c : []);
        setSettings(set || settings);
      })
      .catch(() => setError("Failed to load admin data."))
      .finally(() => setLoading(false));
  }, [authChecked, token, apiFetch]);

  const toggleSuspend = async (uid) => {
    const res = await fetch(`/api/admin/users/${uid}/suspend`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, suspended: data.suspended } : u));
  };

  const toggleDacisFlag = async (uid, currentlyFlagged) => {
    const endpoint = currentlyFlagged ? "/api/dacis/resolve" : "/api/dacis/flag";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetUid: uid, reason: "admin_manual_flag" }),
    });
    const data = await res.json();
    if (res.ok) setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, dacis_flagged: !currentlyFlagged } : u));
    else setError(data.message);
  };

  const handleLoanAction = async (loanId, action) => {
    setLoanActionLoading((prev) => ({ ...prev, [loanId]: true }));
    setError("");
    try {
      const res = await fetch(`/api/admin/loans/${loanId}/${action}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(action === "reject" ? { reason: "Declined by admin" } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Loan action failed.");
      setLoans((prev) => prev.map((loan) => loan.id === loanId ? { ...loan, status: action === "approve" ? "active" : "rejected", updatedAt: new Date().toISOString() } : loan));
      if (action === "approve") setError("Loan approved and funds disbursed.");
    } catch (err) {
      setError(err.message || "Loan action failed.");
    } finally {
      setLoanActionLoading((prev) => ({ ...prev, [loanId]: false }));
    }
  };

  const handleFdStatus = async (id, status) => {
    setFdActionLoading((prev) => ({ ...prev, [id]: true }));
    setError("");
    try {
      const res = await fetch(`/api/admin/fixed-deposits/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "FD action failed.");
      setFixedDeposits((prev) => prev.map((fd) => fd.id === id ? { ...fd, status } : fd));
      setError(data.message);
    } catch (err) {
      setError(err.message || "FD action failed.");
    } finally {
      setFdActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleResolveIncident = async (userId) => {
    setError("");
    try {
      const res = await fetch("/api/dacis/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Resolution failed.");
      setIncidents((prev) => prev.filter((incident) => incident.userId !== userId));
      setUsers((prev) => prev.map((user) => user.uid === userId ? { ...user, dacis_flagged: false } : user));
      setError(data.message);
    } catch (err) {
      setError(err.message || "Resolution failed.");
    }
  };

  const handleManualDacisFlag = async () => {
    if (!dacisTargetUid.trim()) {
      setError("Provide a user ID to flag.");
      return;
    }

    setError("");
    try {
      const res = await fetch("/api/dacis/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetUid: dacisTargetUid.trim(), reason: dacisReason.trim() || "manual_flag" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Flagging failed.");
      setAccountMessage(`DACIS flag applied to ${dacisTargetUid}.`);
      setDacisTargetUid("");
      setDacisReason("manual_flag");
      setUsers((prev) => prev.map((user) => user.uid === dacisTargetUid ? { ...user, dacis_flagged: true } : user));
    } catch (err) {
      setError(err.message || "Flagging failed.");
    }
  };

  const handleAccountCreate = async (e) => {
    e.preventDefault();
    setAccountMessage("");
    setError("");
    try {
      const payload = { ...accountForm };
      // allow admin to set account type and initial deposit
      if (!payload.accountType) payload.accountType = accountForm.accountType || "checking";
      if (!payload.initialDeposit) payload.initialDeposit = Number(accountForm.initialDeposit) || 0;
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create account.");
      setUsers((prev) => [{ uid: data.uid, name: data.name, email: data.email, tier: "Standard", role: "customer", suspended: false, dacis_flagged: false }, ...prev]);
      setAccountMessage(`Customer account created for ${data.email}.`);
      setCreatedAccountInfo(data);
      setAccountForm({ name: "", email: "", password: "", accountType: "checking", initialDeposit: 0 });
    } catch (err) {
      setError(err.message || "Failed to create account.");
    }
  };

  if (!authChecked || loading) {
    return (
      <div className="min-h-screen bg-void-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="material-symbols-outlined text-electric-blue text-[48px] animate-spin">progress_activity</span>
          <p className="text-label-md text-on-surface-variant uppercase tracking-widest">Verifying Admin Credentials...</p>
        </div>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="min-h-screen bg-void-black text-on-surface flex items-center justify-center px-4">
        <div className="glass-panel w-full max-w-md rounded-2xl p-8 text-center">
          <span className="material-symbols-outlined text-electric-blue text-[48px] mb-4" style={{ fontVariationSettings: "'FILL' 1" }}>admin_panel_settings</span>
          <h1 className="text-headline-lg text-pure-white mb-2">Admin access required</h1>
          <p className="text-body-md text-on-surface-variant mb-6">Sign in with the admin account to open the control center.</p>
          <button
            onClick={() => router.replace("/")}
            className="bg-electric-blue text-pure-white px-6 py-3 rounded-lg text-label-md font-bold hover:shadow-[0_0_20px_rgba(255,107,0,0.45)] transition-all"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void-black text-on-surface">
      {/* Background grid */}
      <div className="fixed inset-0 bg-grid pointer-events-none z-0" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-200 h-100 bg-electric-blue/5 blur-[120px] rounded-full pointer-events-none z-0" />

      {/* Top Bar */}
      <header className="fixed top-0 w-full z-50 flex items-center justify-between px-margin-mobile md:px-margin-desktop h-16 bg-surface-container-lowest/70 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-electric-blue text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>admin_panel_settings</span>
          <span className="text-headline-md font-bold text-pure-white">NeuroBank</span>
          <span className="text-label-sm text-electric-blue bg-electric-blue/10 border border-electric-blue/20 px-2 py-0.5 rounded-full">ADMIN</span>
        </div>
        <Link href="/dashboard" className="text-label-md text-on-surface-variant hover:text-pure-white transition-colors flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Customer View
        </Link>
      </header>

      <main className="relative z-10 pt-24 pb-16 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto">
        {error && (
          <div className="mb-6 flex items-center gap-3 p-4 rounded-xl bg-error-container/20 border border-error/30 text-error text-label-md">
            <span className="material-symbols-outlined text-[18px]">error</span>{error}
          </div>
        )}

        {/* Page Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-headline-xl text-pure-white">Control Center</h1>
            <p className="text-body-md text-on-surface-variant mt-1">DACIS Admin — Full system access</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container border border-outline-variant">
            <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_#4ade80]" />
            <span className="text-label-sm text-on-surface-variant">All Systems Nominal</span>
          </div>
        </div>

        {/* Tab Nav */}
        <div className="glass-panel rounded-xl p-1 inline-flex gap-1 mb-8 overflow-x-auto">
          {[
            { id: "overview", icon: "dashboard", label: "Overview" },
            { id: "users", icon: "group", label: "Users" },
            { id: "loans", icon: "request_quote", label: "Loans" },
            { id: "cards", icon: "credit_card", label: "Cards" },
            { id: "fixed-deposits", icon: "savings", label: "FDs" },
            { id: "dacis", icon: "security", label: "DACIS" },
            { id: "system", icon: "settings", label: "System" },
            { id: "accounts", icon: "person_add", label: "Accounts" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-label-md transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-electric-blue text-pure-white shadow-[0_0_15px_rgba(13,23,231,0.3)]"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-white/5"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <StatCard icon="group" label="Total Users" value={stats?.totalUsers} sub="Registered nodes" />
              <StatCard icon="request_quote" label="Pending Loans" value={loans.filter(l => l.status === "pending").length} sub="Awaiting review" color="text-primary" />
              <StatCard icon="account_balance" label="Accounts" value={stats?.totalAccounts} sub="Active accounts" color="text-tertiary" />
            </div>

            {/* System overview panel */}
            <div className="glass-panel rounded-xl p-6">
              <h2 className="text-headline-md text-pure-white mb-2">System Overview</h2>
              <p className="text-label-sm text-on-surface-variant">Pending loans and open DACIS incidents are shown in their tabs for privacy.</p>
            </div>
          </div>
        )}

        {/* ── Users Tab ── */}
        {activeTab === "users" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-6 border-b border-white/5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-headline-md text-pure-white">Registered Nodes ({users.length})</h2>
                <div className="flex items-center gap-3">
                  <input placeholder="User ID" value={creditUid} onChange={(e) => setCreditUid(e.target.value)} className="rounded-lg p-2 bg-surface-container-lowest text-label-sm" />
                  <input placeholder="Amount" type="number" value={creditAmount} onChange={(e) => setCreditAmount(Number(e.target.value))} className="rounded-lg p-2 bg-surface-container-lowest text-label-sm w-28" />
                  <button onClick={async () => {
                    if (!creditUid || !creditAmount) { setError('Provide user id and amount'); return; }
                    try {
                      const res = await fetch(`/api/admin/users/${creditUid}/credit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ amount: creditAmount }) });
                      const d = await res.json();
                      if (!res.ok) throw new Error(d.message || 'Credit failed');
                      setAccountMessage(`Credited ${creditAmount} to ${creditUid}. New balance: ${d.newBalance}`);
                      setCreditUid(''); setCreditAmount(0);
                    } catch (err) { setError(err.message || 'Credit failed'); }
                  }} className="rounded-lg bg-electric-blue px-3 py-2 text-pure-white">Credit</button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    {["User", "Email", "Tier", "Role", "Status", "Actions"].map((h) => (
                      <th key={h} className="px-6 py-4 text-label-sm text-on-surface-variant uppercase tracking-wider font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.uid} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-primary text-[16px]">person</span>
                          </div>
                          <span className="text-body-md text-pure-white">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-label-md text-on-surface-variant font-mono">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className="text-label-sm text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-full">{user.tier}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-label-sm px-2 py-1 rounded-full border ${
                          user.role === "admin"
                            ? "text-electric-blue bg-electric-blue/10 border-electric-blue/20"
                            : "text-on-surface-variant bg-surface-container border-outline-variant"
                        }`}>{user.role}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${user.suspended ? "bg-error" : "bg-green-400 shadow-[0_0_6px_#4ade80]"}`} />
                          <span className="text-label-sm text-on-surface-variant">{user.suspended ? "Suspended" : "Active"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSuspend(user.uid)}
                            className={`text-label-sm px-3 py-1.5 rounded-lg border transition-all ${
                              user.suspended
                                ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                                : "border-error/30 text-error hover:bg-error/10"
                            }`}
                          >
                            {user.suspended ? "Reinstate" : "Suspend"}
                          </button>
                          <button
                            onClick={() => toggleDacisFlag(user.uid, user.dacis_flagged)}
                            className={`text-label-sm px-3 py-1.5 rounded-lg border transition-all ${
                              user.dacis_flagged
                                ? "border-primary/30 text-primary hover:bg-primary/10"
                                : "border-tertiary/30 text-tertiary hover:bg-tertiary/10"
                            }`}
                          >
                            {user.dacis_flagged ? "Clear DACIS" : "Flag DACIS"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        

        {/* ── Loans Tab ── */}
        {activeTab === "loans" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <h2 className="text-headline-md text-pure-white">Loan Applications ({loans.length})</h2>
              <span className="text-label-sm text-on-surface-variant">Approve or reject pending loan requests.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    {[
                      "ID",
                      "User",
                      "Type",
                      "Amount",
                      "Status",
                      "Created",
                      "Actions",
                    ].map((h) => (
                      <th key={h} className="px-6 py-4 text-label-sm text-on-surface-variant uppercase tracking-wider font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan.id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors">
                      <td className="px-6 py-4 text-label-sm font-mono text-on-surface-variant">{loan.id.slice(0, 8)}</td>
                      <td className="px-6 py-4 text-body-md text-pure-white">{loan.userName || loan.userId}</td>
                      <td className="px-6 py-4 text-label-sm text-on-surface-variant">{loan.type}</td>
                      <td className="px-6 py-4 text-label-md text-electric-blue font-mono">${loan.amount?.toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <span className={`text-label-sm px-2 py-1 rounded-full border ${
                          loan.status === "pending"
                            ? "text-tertiary bg-tertiary/10 border-tertiary/20"
                            : loan.status === "active"
                            ? "text-primary bg-primary/10 border-primary/20"
                            : "text-error bg-error/10 border-error/20"
                        }`}>{loan.status}</span>
                      </td>
                      <td className="px-6 py-4 text-label-sm text-on-surface-variant">{loan.createdAt?.slice(0, 10)}</td>
                      <td className="px-6 py-4 flex flex-wrap gap-2">
                        {loan.status === "pending" ? (
                          <>
                            <button
                              disabled={loanActionLoading[loan.id]}
                              onClick={() => handleLoanAction(loan.id, "approve")}
                              className="text-label-sm px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-all"
                            >
                              Approve
                            </button>
                            <button
                              disabled={loanActionLoading[loan.id]}
                              onClick={() => handleLoanAction(loan.id, "reject")}
                              className="text-label-sm px-3 py-1.5 rounded-lg border border-error/30 text-error hover:bg-error/10 transition-all"
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="text-label-sm text-on-surface-variant">No actions</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Cards Tab ── */}
        {activeTab === "cards" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-headline-md text-pure-white">Cards ({cards.length})</h2>
              <span className="text-label-sm text-on-surface-variant">Issue and manage customer cards.</span>
            </div>
            <div className="p-6 grid md:grid-cols-2 gap-6">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5 text-left">
                      {["ID", "User", "Number", "Type", "Expiry", "Status"].map((h) => (
                        <th key={h} className="px-6 py-3 text-label-sm text-on-surface-variant uppercase tracking-wider font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((card) => (
                      <tr key={card.id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors">
                        <td className="px-6 py-3 text-label-sm font-mono text-on-surface-variant">{card.id.slice(0,8)}</td>
                        <td className="px-6 py-3 text-body-md text-pure-white">{card.holderName || card.userId}</td>
                        <td className="px-6 py-3 text-label-sm text-on-surface-variant">{card.number}</td>
                        <td className="px-6 py-3 text-label-sm text-on-surface-variant">{card.cardType}</td>
                        <td className="px-6 py-3 text-label-sm text-on-surface-variant">{card.expiry}</td>
                        <td className="px-6 py-3 text-label-sm text-on-surface-variant">{card.frozen ? 'Frozen' : 'Active'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 bg-surface-container rounded-xl">
                <h3 className="text-body-md text-pure-white mb-3">Issue New Card</h3>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const form = new FormData(e.target);
                  const body = { userId: form.get('userId'), cardType: form.get('cardType'), name: form.get('name') };
                  try {
                    const res = await fetch('/api/admin/cards/issue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.message || 'Failed to issue card');
                    setCards(prev => [data, ...prev]);
                  } catch (err) { setError(err.message || 'Failed to issue card'); }
                }} className="space-y-3">
                  <label className="text-label-sm text-on-surface-variant block">
                    User
                    <select name="userId" className="w-full mt-1 rounded-xl p-2 bg-surface-container-lowest">
                      <option value="">Select user</option>
                      {users.map(u => <option key={u.uid} value={u.uid}>{u.email} — {u.name}</option>)}
                    </select>
                  </label>
                  <label className="text-label-sm text-on-surface-variant block">
                    Card Type
                    <select name="cardType" className="w-full mt-1 rounded-xl p-2 bg-surface-container-lowest" defaultValue="virtual">
                      <option value="virtual">Virtual</option>
                      <option value="physical">Physical</option>
                    </select>
                  </label>
                  <label className="text-label-sm text-on-surface-variant block">
                    Card Name
                    <input name="name" placeholder="Neuro Virtual" className="w-full mt-1 rounded-xl p-2 bg-surface-container-lowest" />
                  </label>
                  <button className="w-full rounded-xl bg-electric-blue px-4 py-2 text-pure-white">Issue Card</button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ── Fixed Deposits Tab ── */}
        {activeTab === "fixed-deposits" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <h2 className="text-headline-md text-pure-white">Fixed Deposits ({fixedDeposits.length})</h2>
              <span className="text-label-sm text-on-surface-variant">Manage FD statuses and customer deposits.</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    {[
                      "ID",
                      "User",
                      "Amount",
                      "Maturity",
                      "Status",
                      "Created",
                      "Actions",
                    ].map((h) => (
                      <th key={h} className="px-6 py-4 text-label-sm text-on-surface-variant uppercase tracking-wider font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fixedDeposits.map((fd) => (
                    <tr key={fd.id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors">
                      <td className="px-6 py-4 text-label-sm font-mono text-on-surface-variant">{fd.id.slice(0, 8)}</td>
                      <td className="px-6 py-4 text-body-md text-pure-white">{fd.userName || fd.userId}</td>
                      <td className="px-6 py-4 text-label-md text-primary font-mono">${fd.amount?.toFixed(2)}</td>
                      <td className="px-6 py-4 text-label-sm text-on-surface-variant">{fd.maturityDate || fd.maturity || "TBD"}</td>
                      <td className="px-6 py-4">
                        <span className={`text-label-sm px-2 py-1 rounded-full border ${
                          fd.status === "active"
                            ? "text-primary bg-primary/10 border-primary/20"
                            : fd.status === "matured"
                            ? "text-electric-blue bg-electric-blue/10 border-electric-blue/20"
                            : "text-on-surface-variant bg-surface-container border-outline-variant"
                        }`}>{fd.status}</span>
                      </td>
                      <td className="px-6 py-4 text-label-sm text-on-surface-variant">{fd.createdAt?.slice(0, 10)}</td>
                      <td className="px-6 py-4 flex flex-wrap gap-2">
                        <button
                          disabled={fdActionLoading[fd.id]}
                          onClick={() => handleFdStatus(fd.id, "active")}
                          className="text-label-sm px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-all"
                        >
                          Set Active
                        </button>
                        <button
                          disabled={fdActionLoading[fd.id]}
                          onClick={() => handleFdStatus(fd.id, "matured")}
                          className="text-label-sm px-3 py-1.5 rounded-lg border border-secondary/30 text-secondary hover:bg-secondary/10 transition-all"
                        >
                          Set Matured
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DACIS Tab ── */}
        {activeTab === "dacis" && <DacisTab
          token={token}
          apiFetch={apiFetch}
          incidents={incidents}
          dacisTargetUid={dacisTargetUid}
          setDacisTargetUid={setDacisTargetUid}
          dacisReason={dacisReason}
          setDacisReason={setDacisReason}
          handleManualDacisFlag={handleManualDacisFlag}
          handleResolveIncident={handleResolveIncident}
          dacisHealth={dacisHealth}
          setDacisHealth={setDacisHealth}
          dacisCacheStats={dacisCacheStats}
          setDacisCacheStats={setDacisCacheStats}
          dacisLiveFeed={dacisLiveFeed}
          setDacisLiveFeed={setDacisLiveFeed}
          dacisWsConnected={dacisWsConnected}
          setDacisWsConnected={setDacisWsConnected}
          burstRingSize={burstRingSize}
          setBurstRingSize={setBurstRingSize}
          burstLength={burstLength}
          setBurstLength={setBurstLength}
          burstLoading={burstLoading}
          setBurstLoading={setBurstLoading}
          burstResults={burstResults}
          setBurstResults={setBurstResults}
          dacisWsRef={dacisWsRef}
          liveFeedRef={liveFeedRef}
          setError={setError}
        />}

        {/* ── System Tab ── */}
        {activeTab === "system" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-6 border-b border-white/5">
              <h2 className="text-headline-md text-pure-white">System Settings</h2>
              <p className="text-label-sm text-on-surface-variant mt-1">Configure default intervals for loans, FDs and cards.</p>
            </div>
            <div className="p-6 max-w-lg">
              <label className="block text-label-sm text-on-surface-variant mb-2">Loan payment interval (days)</label>
              <input type="number" value={settings.loanPaymentIntervalDays} onChange={(e) => setSettings((s) => ({ ...s, loanPaymentIntervalDays: parseInt(e.target.value || 0) }))} className="w-full rounded-xl p-2 bg-surface-container-lowest mb-4" />

              <label className="block text-label-sm text-on-surface-variant mb-2">Default FD term (months)</label>
              <input type="number" value={settings.fdDefaultTermMonths} onChange={(e) => setSettings((s) => ({ ...s, fdDefaultTermMonths: parseInt(e.target.value || 0) }))} className="w-full rounded-xl p-2 bg-surface-container-lowest mb-4" />

              <label className="block text-label-sm text-on-surface-variant mb-2">Card expiry (years)</label>
              <input type="number" value={settings.cardExpiryYears} onChange={(e) => setSettings((s) => ({ ...s, cardExpiryYears: parseInt(e.target.value || 0) }))} className="w-full rounded-xl p-2 bg-surface-container-lowest mb-4" />

              <div className="flex gap-3">
                <button onClick={() => saveSettings(settings)} className="rounded-xl bg-electric-blue px-4 py-2 text-pure-white">Save</button>
                <button onClick={() => setSettings({ loanPaymentIntervalDays: 30, fdDefaultTermMonths: 12, cardExpiryYears: 3 })} className="rounded-xl border px-4 py-2">Reset</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Accounts Tab ── */}
        {activeTab === "accounts" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-6 border-b border-white/5">
              <h2 className="text-headline-md text-pure-white">Create Customer Account</h2>
              <p className="text-label-sm text-on-surface-variant mt-1">Add new customer users directly from the admin portal.</p>
            </div>
            <div className="p-6">
              {accountMessage && (
                <div className="mb-4 rounded-xl bg-primary/10 border border-primary/20 p-4 text-primary text-label-sm">{accountMessage}</div>
              )}
              <form onSubmit={handleAccountCreate} className="grid gap-4 max-w-xl">
                {[
                  { label: "Full Name", name: "name", type: "text" },
                  { label: "Email", name: "email", type: "email" },
                  { label: "Password (optional)", name: "password", type: "password" },
                ].map((field) => (
                  <label key={field.name} className="space-y-2 text-label-sm text-on-surface-variant">
                    <span>{field.label}</span>
                    <input
                      className="w-full rounded-xl border border-white/10 bg-surface-container-lowest px-4 py-3 text-body-md text-pure-white outline-none focus:border-electric-blue/50 focus:ring-2 focus:ring-electric-blue/10"
                      type={field.type}
                      value={accountForm[field.name]}
                      onChange={(e) => setAccountForm((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      required
                    />
                  </label>
                ))}
                <label className="space-y-2 text-label-sm text-on-surface-variant">
                  <span>Account Type</span>
                  <select className="w-full rounded-xl p-2 bg-surface-container-lowest" value={accountForm.accountType || "checking"} onChange={(e) => setAccountForm((prev) => ({ ...prev, accountType: e.target.value }))}>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                  </select>
                </label>
                <label className="space-y-2 text-label-sm text-on-surface-variant">
                  <span>Initial Deposit</span>
                  <input type="number" min="0" step="0.01" className="w-full rounded-xl border border-white/10 bg-surface-container-lowest px-4 py-3 text-body-md text-pure-white" value={accountForm.initialDeposit || 0} onChange={(e) => setAccountForm((prev) => ({ ...prev, initialDeposit: e.target.value }))} />
                </label>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-electric-blue px-5 py-3 text-label-md text-pure-white hover:bg-primary transition-colors"
                >
                  Create Customer
                </button>
              </form>
            </div>
          </div>
        )}
        {createdAccountInfo && (
          <div className="glass-panel rounded-xl p-6 mt-6">
            <h3 className="text-body-md text-pure-white mb-2">Created Account</h3>
            <p className="text-label-sm text-on-surface-variant">UID: <span className="font-mono">{createdAccountInfo.uid}</span></p>
            <p className="text-label-sm text-on-surface-variant">Account #: <span className="font-mono">{createdAccountInfo.accountNumber}</span></p>
            <p className="text-label-sm text-on-surface-variant">Email sent: {createdAccountInfo.emailSent ? "Yes" : "No"}</p>
            {createdAccountInfo.resetLink && (
              <p className="text-label-sm mt-2">Password setup link (copy to user): <a className="text-electric-blue" href={createdAccountInfo.resetLink}>{createdAccountInfo.resetLink}</a></p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── DACIS Live Telemetry Tab ─── */
function DacisTab({
  token, apiFetch, incidents,
  dacisTargetUid, setDacisTargetUid, dacisReason, setDacisReason,
  handleManualDacisFlag, handleResolveIncident,
  dacisHealth, setDacisHealth, dacisCacheStats, setDacisCacheStats,
  dacisLiveFeed, setDacisLiveFeed, dacisWsConnected, setDacisWsConnected,
  burstRingSize, setBurstRingSize, burstLength, setBurstLength,
  burstLoading, setBurstLoading, burstResults, setBurstResults,
  dacisWsRef, liveFeedRef, setError,
}) {
  // ── Fetch DACIS health + cache stats on mount & every 10s ──
  useEffect(() => {
    if (!token) return;
    const fetchStatus = () => {
      apiFetch("/api/dacis-engine/health").then(setDacisHealth).catch(() => setDacisHealth({ status: "offline", reachable: false }));
      apiFetch("/api/dacis-engine/cache-stats").then(setDacisCacheStats).catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [token, apiFetch, setDacisHealth, setDacisCacheStats]);

  // ── WebSocket connection to DACIS live stream ──
  useEffect(() => {
    if (!token) return;

    // Connect to the DACIS backend WebSocket
    const wsUrl = `ws://localhost:8000/ws/stream`;
    let ws;
    let reconnectTimer;

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        dacisWsRef.current = ws;

        ws.onopen = () => setDacisWsConnected(true);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setDacisLiveFeed((prev) => [data, ...prev].slice(0, 100));
          } catch {}
        };

        ws.onclose = () => {
          setDacisWsConnected(false);
          // Attempt reconnect after 3s
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          setDacisWsConnected(false);
          ws.close();
        };
      } catch {
        setDacisWsConnected(false);
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // prevent reconnect on unmount
        ws.close();
      }
      setDacisWsConnected(false);
    };
  }, [token, dacisWsRef, setDacisWsConnected, setDacisLiveFeed]);

  // ── Burst trigger ──
  const handleBurst = async () => {
    setBurstLoading(true);
    setBurstResults(null);
    setError("");
    try {
      const res = await fetch("/api/dacis-engine/burst", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ring_size: burstRingSize, burst_length: burstLength }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Burst trigger failed.");
      setBurstResults(data);
    } catch (err) {
      setError(err.message || "Burst trigger failed.");
    } finally {
      setBurstLoading(false);
    }
  };

  const isOnline = dacisHealth?.status === "ok" || dacisHealth?.status === "degraded";

  // Score severity color
  function scoreColor(score) {
    if (score >= 0.7) return "text-error";
    if (score >= 0.4) return "text-amber-400";
    return "text-green-400";
  }

  function scoreBg(score) {
    if (score >= 0.7) return "bg-error/20 border-error/40";
    if (score >= 0.4) return "bg-amber-400/20 border-amber-400/40";
    return "bg-green-400/20 border-green-400/40";
  }

  return (
    <div className="space-y-6">
      {/* ── Row 1: Engine Health + Cache Stats + WS Status ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Engine Health */}
        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">DACIS Engine</span>
            <div className={`w-3 h-3 rounded-full ${isOnline ? "bg-green-400 shadow-[0_0_8px_#4ade80]" : "bg-error shadow-[0_0_8px_#f44336]"} animate-pulse`} />
          </div>
          <p className={`text-headline-md font-bold ${isOnline ? "text-green-400" : "text-error"}`}>
            {dacisHealth ? (dacisHealth.status === "ok" ? "Online" : dacisHealth.status === "degraded" ? "Degraded" : "Offline") : "Checking…"}
          </p>
          <div className="mt-2 space-y-1 text-label-sm text-on-surface-variant">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dacisHealth?.redis_connected ? "bg-green-400" : "bg-error"}`} />
              Redis: {dacisHealth?.redis_connected ? "Connected" : "Disconnected"}
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${dacisHealth?.model_loaded ? "bg-green-400" : "bg-error"}`} />
              Model: {dacisHealth?.model_loaded ? "Loaded" : "Not loaded"}
            </div>
          </div>
        </div>

        {/* Cache Stats */}
        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">Cache</span>
            <span className="material-symbols-outlined text-primary text-[20px]">memory</span>
          </div>
          {dacisCacheStats ? (
            <>
              <p className="text-headline-md text-primary font-bold">{dacisCacheStats.l1_size ?? "—"}<span className="text-body-md text-on-surface-variant"> / {dacisCacheStats.l1_max_size ?? "—"}</span></p>
              <p className="text-label-sm text-on-surface-variant mt-1">L1 (In-Process LRU)</p>
              <div className="w-full h-1.5 rounded-full bg-surface-container-high mt-2 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, ((dacisCacheStats.l1_size || 0) / (dacisCacheStats.l1_max_size || 1)) * 100)}%` }} />
              </div>
              <p className="text-label-sm text-on-surface-variant mt-3">L2 (Redis): <span className="text-pure-white font-mono">{dacisCacheStats.l2_key_count ?? "—"}</span> keys</p>
            </>
          ) : (
            <p className="text-label-sm text-on-surface-variant">Unavailable</p>
          )}
        </div>

        {/* WebSocket Status */}
        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">Live Stream</span>
            <span className="material-symbols-outlined text-electric-blue text-[20px]">sensors</span>
          </div>
          <p className={`text-headline-md font-bold ${dacisWsConnected ? "text-electric-blue" : "text-on-surface-variant"}`}>
            {dacisWsConnected ? "Connected" : "Disconnected"}
          </p>
          <p className="text-label-sm text-on-surface-variant mt-1">{dacisLiveFeed.length} events received</p>
          {dacisWsConnected && (
            <div className="flex items-center gap-2 mt-3">
              <div className="w-2 h-2 rounded-full bg-electric-blue animate-pulse" />
              <span className="text-label-sm text-electric-blue">Streaming transactions…</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Burst Trigger ── */}
      <div className="glass-panel rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-error" style={{ fontVariationSettings: "'FILL' 1" }}>crisis_alert</span>
          <h3 className="text-headline-md text-pure-white">Fraud Ring Injection</h3>
          <span className="text-label-sm text-on-surface-variant">(Demo / Testing)</span>
        </div>
        <p className="text-label-sm text-on-surface-variant mb-4">
          Inject a synthetic coordinated fraud ring into the DACIS pipeline. Watch the live feed below for gate activations.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1">
            <span className="text-label-sm text-on-surface-variant">Ring Size</span>
            <input
              type="number" min={2} max={20} value={burstRingSize}
              onChange={(e) => setBurstRingSize(Math.max(2, parseInt(e.target.value) || 2))}
              className="block w-24 rounded-lg p-2 bg-surface-container-lowest text-pure-white text-label-md border border-outline-variant/40"
            />
          </label>
          <label className="space-y-1">
            <span className="text-label-sm text-on-surface-variant">Burst Length</span>
            <input
              type="number" min={1} max={200} value={burstLength}
              onChange={(e) => setBurstLength(Math.max(1, parseInt(e.target.value) || 1))}
              className="block w-24 rounded-lg p-2 bg-surface-container-lowest text-pure-white text-label-md border border-outline-variant/40"
            />
          </label>
          <button
            onClick={handleBurst}
            disabled={burstLoading || !isOnline}
            className="rounded-lg bg-error text-pure-white px-6 py-2.5 text-label-md font-semibold hover:bg-error/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-[0_0_15px_rgba(244,67,54,0.25)]"
          >
            {burstLoading ? (
              <><span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>Injecting…</>
            ) : (
              <><span className="material-symbols-outlined text-[18px]">bolt</span>Trigger Burst</>
            )}
          </button>
        </div>
        {burstResults && (
          <div className="mt-4 p-3 rounded-lg bg-error/10 border border-error/20 text-label-sm">
            <span className="text-error font-semibold">{Array.isArray(burstResults) ? burstResults.length : 0}</span>
            <span className="text-on-surface-variant"> transactions injected. </span>
            <span className="text-error font-semibold">{Array.isArray(burstResults) ? burstResults.filter(r => r.gate1_fired).length : 0}</span>
            <span className="text-on-surface-variant"> triggered Gate 1.</span>
          </div>
        )}
      </div>

      {/* ── Row 3: Live Transaction Feed ── */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-electric-blue">stream</span>
            <h3 className="text-headline-md text-pure-white">Live Transaction Feed</h3>
            {dacisWsConnected && <span className="w-2 h-2 rounded-full bg-electric-blue animate-pulse" />}
          </div>
          {dacisLiveFeed.length > 0 && (
            <button onClick={() => setDacisLiveFeed([])} className="text-label-sm text-on-surface-variant hover:text-error transition-colors">Clear</button>
          )}
        </div>
        <div ref={liveFeedRef} className="max-h-[400px] overflow-y-auto custom-scroll">
          {dacisLiveFeed.length === 0 ? (
            <div className="p-8 text-center text-on-surface-variant text-label-md">
              {dacisWsConnected ? "Waiting for transactions…" : "Connect to DACIS to see live transactions."}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {dacisLiveFeed.map((txn, i) => (
                <div key={txn.transaction_id + "_" + i} className={`px-5 py-3 hover:bg-white/3 transition-colors ${txn.gate1_fired ? "border-l-2 border-l-error" : ""}`}>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    {/* Left: IDs + amount */}
                    <div className="flex items-center gap-4 min-w-0">
                      <span className="text-label-sm font-mono text-on-surface-variant w-20 shrink-0 truncate">{txn.transaction_id?.slice(0, 12)}</span>
                      <div className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                        <span className="text-pure-white font-mono">{txn.sender_id?.slice(0, 10)}</span>
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        <span className="text-pure-white font-mono">{txn.receiver_id?.slice(0, 10)}</span>
                      </div>
                      <span className="text-label-md text-electric-blue font-mono">${txn.amount?.toFixed?.(2) ?? txn.amount}</span>
                    </div>

                    {/* Right: Score + badges */}
                    <div className="flex items-center gap-2">
                      <span className={`text-label-md font-bold font-mono px-2 py-0.5 rounded border ${scoreBg(txn.dg_score)} ${scoreColor(txn.dg_score)}`}>
                        {(txn.dg_score ?? 0).toFixed(4)}
                      </span>
                      {txn.gate1_fired && (
                        <span className="text-label-sm px-2 py-0.5 rounded bg-error/20 border border-error/40 text-error font-semibold">G1</span>
                      )}
                      {txn.gate2_confirmed && (
                        <span className="text-label-sm px-2 py-0.5 rounded bg-amber-400/20 border border-amber-400/40 text-amber-400 font-semibold">G2</span>
                      )}
                      {txn.cache_invalidated_accounts?.length > 0 && (
                        <span className="text-label-sm px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary" title={`Invalidated: ${txn.cache_invalidated_accounts.join(", ")}`}>
                          ♻ {txn.cache_invalidated_accounts.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 4: Manual Flag + Incidents (existing) ── */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <h2 className="text-headline-md text-pure-white">Security Incidents ({incidents.length})</h2>
          <span className="text-label-sm text-on-surface-variant">Resolve incidents and clear manual flags.</span>
        </div>
        <div className="p-6 border-b border-white/5 bg-white/[0.02]">
          <h3 className="text-label-md uppercase tracking-wider text-pure-white mb-3">Manual Account Flag</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-4xl">
            <input
              value={dacisTargetUid}
              onChange={(e) => setDacisTargetUid(e.target.value)}
              placeholder="User UID"
              className="rounded-lg p-3 bg-surface-container-lowest text-label-sm text-pure-white border border-outline-variant/40"
            />
            <input
              value={dacisReason}
              onChange={(e) => setDacisReason(e.target.value)}
              placeholder="Reason"
              className="rounded-lg p-3 bg-surface-container-lowest text-label-sm text-pure-white border border-outline-variant/40"
            />
            <button
              onClick={handleManualDacisFlag}
              className="rounded-lg bg-error text-pure-white px-4 py-3 text-label-md font-semibold hover:bg-error/90 transition-colors"
            >
              Flag Account
            </button>
          </div>
          <p className="text-label-sm text-on-surface-variant mt-3">This creates a DACIS incident and freezes the user until resolved.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 text-left">
                {["Incident ID", "User", "Reason", "Status", "Created", "Actions"].map((h) => (
                  <th key={h} className="px-6 py-4 text-label-sm text-on-surface-variant uppercase tracking-wider font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors">
                  <td className="px-6 py-4 text-label-sm font-mono text-on-surface-variant">{incident.id.slice(0, 8)}</td>
                  <td className="px-6 py-4 text-body-md text-pure-white">{incident.userId}</td>
                  <td className="px-6 py-4 text-label-sm text-on-surface-variant max-w-[200px] truncate">{incident.reason || "DACIS flag"}</td>
                  <td className="px-6 py-4 text-label-sm text-primary">Open</td>
                  <td className="px-6 py-4 text-label-sm text-on-surface-variant">{incident.createdAt?.slice(0, 10)}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleResolveIncident(incident.userId)}
                      className="text-label-sm px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-all"
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
