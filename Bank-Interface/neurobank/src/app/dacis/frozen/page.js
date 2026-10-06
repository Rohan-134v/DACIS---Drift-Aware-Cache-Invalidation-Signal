"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";

export default function FrozenPage() {
  const router = useRouter();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Fetch real incident data ──
  useEffect(() => {
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) { setLoading(false); return; }

        const res = await fetch("/api/dacis/check", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.flagged) {
          setIncident({
            reason: data.reason || "security_intervention",
            score: data.dg_score,
          });
        }
      } catch {
        // fail silent — use defaults
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleResolve = async () => {
    setResolving(true);
    setError("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/dacis/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      router.replace("/dashboard");
    } catch (err) {
      setError(err.message || "Verification failed. Please contact support.");
      setResolving(false);
    }
  };

  // Determine display values from real data
  const isDacisAutoFlag = incident?.reason?.includes("dg_score");
  const displayReason = isDacisAutoFlag
    ? "DACIS AI Fraud Detection"
    : incident?.reason === "account_suspended"
    ? "Account Suspended by Admin"
    : incident?.reason === "manual_flag" || incident?.reason === "admin_manual_flag"
    ? "Manual Admin Flag"
    : "Security Intervention";

  // Extract dg_score from reason string if present
  const scoreMatch = incident?.reason?.match(/dg_score=([\d.]+)/);
  const displayScore = scoreMatch ? (parseFloat(scoreMatch[1]) * 100).toFixed(1) : null;

  const analysisText = isDacisAutoFlag
    ? "The DACIS drift-aware cache invalidation signal detected anomalous transaction patterns from your account. The GraphSAGE-based temporal GNN inference pipeline identified behavioral drift exceeding the Welford z-score threshold, triggering an account-level gate activation. This indicates a statistically significant deviation from your established transaction baseline."
    : "Anomalous activity detected on your account. Our security systems have flagged this session for review. Immediate verification is required to restore full access and secure the integrity of your data ledger.";

  return (
    <article
      className="w-full glass-panel rounded-[24px] p-6 md:p-12 flex flex-col gap-8 glow-error"
      style={{
        background: "linear-gradient(180deg, rgba(22,23,38,0.8) 0%, rgba(12,13,24,0.9) 100%)",
        borderTop: "1px solid rgba(255,255,255,0.15)",
      }}
    >
      {/* Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center border border-error/20 animate-warning">
            <span className="material-symbols-outlined text-error text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>gpp_maybe</span>
          </div>
          <div>
            <h1 className="text-headline-lg text-on-surface">Account Freeze Active</h1>
            <p className="text-body-md text-error tracking-wide">Your access is blocked until the freeze is revoked.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-surface-container/50 px-4 py-2 rounded-full border border-white/5">
          <div className="w-2 h-2 rounded-full bg-error animate-pulse" />
          <span className="text-label-sm text-on-surface-variant">System Locked</span>
        </div>
      </header>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
        {/* Trigger Event */}
        <div className="glass-bento rounded-xl p-6 col-span-1 md:col-span-8 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors duration-500 -translate-y-1/2 translate-x-1/2" />
          <div>
            <h2 className="text-label-sm text-on-surface-variant mb-1">Trigger Event</h2>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">{isDacisAutoFlag ? "crisis_alert" : "login"}</span>
              <p className="text-headline-md text-on-surface">{displayReason}</p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-label-sm text-on-surface-variant/70">Vector</span>
              <span className="text-body-md text-on-surface">
                {isDacisAutoFlag ? "Transaction Anomaly Detection" : "Security Policy Violation"}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-label-sm text-on-surface-variant/70">Timestamp</span>
              <span className="text-body-md text-on-surface font-mono">{new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</span>
            </div>
          </div>
        </div>

        {/* Confidence Score */}
        <div className="glass-bento rounded-xl p-6 col-span-1 md:col-span-4 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <h2 className="text-label-sm text-on-surface-variant absolute top-6 left-6">
            {isDacisAutoFlag ? "DACIS Score" : "Confidence Score"}
          </h2>
          <div className="relative w-32 h-32 mt-4 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-surface-container-high" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent" style={{
              borderTopColor: displayScore && parseFloat(displayScore) > 70 ? "#f44336" : "#bec2ff",
              borderRightColor: displayScore && parseFloat(displayScore) > 70 ? "#f44336" : "#bec2ff",
              borderBottomColor: displayScore && parseFloat(displayScore) > 70 ? "#f44336" : "#bec2ff",
              transform: "rotate(45deg)",
            }} />
            <div className="flex flex-col items-center">
              <span className={`text-display-md ${displayScore && parseFloat(displayScore) > 70 ? "text-error" : "text-primary"}`} style={{ filter: displayScore && parseFloat(displayScore) > 70 ? "drop-shadow(0 0 10px rgba(244,67,54,0.5))" : "drop-shadow(0 0 10px rgba(190,194,255,0.5))" }}>
                {displayScore ?? "—"}<span className="text-[20px]">%</span>
              </span>
            </div>
          </div>
          <p className="text-label-sm text-on-surface-variant mt-2">
            {isDacisAutoFlag ? "Drift-gated fraud probability" : "Threat confidence level"}
          </p>
        </div>

        {/* AI Analysis */}
        <div className="glass-bento rounded-xl p-6 col-span-1 md:col-span-12 flex flex-col md:flex-row gap-6 items-start border-l-2 border-l-primary/50">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <span className="material-symbols-outlined text-primary">psychology</span>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-label-sm text-primary">DACIS AI Analysis</h2>
            <p className="text-body-lg text-on-surface-variant leading-relaxed">
              {analysisText}
            </p>
            {isDacisAutoFlag && (
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="text-label-sm px-2 py-1 rounded bg-error/20 border border-error/40 text-error">Gate 1 Fired</span>
                {incident?.reason?.includes("gate2_confirmed=true") && (
                  <span className="text-label-sm px-2 py-1 rounded bg-amber-400/20 border border-amber-400/40 text-amber-400">Gate 2 Confirmed</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-error-container/20 border border-error/30 text-error text-label-md">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {error}
        </div>
      )}

      {/* Action Footer */}
      <footer className="flex flex-col sm:flex-row items-center justify-end gap-4 pt-6 border-t border-white/5 mt-2">
        <a
          href="mailto:support@neurobank.io"
          className="w-full sm:w-auto px-6 py-3 rounded-lg border border-white/10 bg-transparent text-primary text-label-md hover:bg-white/5 hover:border-primary/50 transition-all duration-300 flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">support_agent</span>
          Chat with agent
        </a>
        <button
          onClick={handleResolve}
          disabled={resolving}
          className="w-full sm:w-auto px-6 py-3 rounded-lg bg-primary text-on-primary text-label-md hover:bg-white hover:shadow-[0_0_20px_rgba(190,194,255,0.4)] transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {resolving ? (
            <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>Verifying...</>
          ) : (
            <><span className="material-symbols-outlined text-[18px]">verified_user</span>Tell us it was you</>
          )}
        </button>
      </footer>
    </article>
  );
}
