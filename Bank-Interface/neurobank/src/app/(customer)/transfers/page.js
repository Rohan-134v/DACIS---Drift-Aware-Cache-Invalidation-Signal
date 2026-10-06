"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { formatINR } from "@/lib/money";

/* ── Step indicator ── */
function Step({ n, label, active, done }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-label-sm font-bold border transition-all duration-300 ${
        done  ? "bg-electric-blue border-electric-blue text-pure-white shadow-[0_0_10px_rgba(255,107,0,0.4)]"
              : active ? "border-electric-blue text-electric-blue bg-electric-blue/10"
              : "border-outline-variant text-on-surface-variant"
      }`}>
        {done ? <span className="material-symbols-outlined text-[14px]">check</span> : n}
      </div>
      <span className={`text-label-sm hidden sm:block ${active || done ? "text-on-surface" : "text-on-surface-variant"}`}>{label}</span>
    </div>
  );
}

function StepDivider({ done }) {
  return <div className={`flex-1 h-[1px] mx-1 transition-all duration-500 ${done ? "bg-electric-blue/50" : "bg-outline-variant/40"}`} />;
}

export default function TransfersPage() {
  const router = useRouter();
  const [user, setUser]             = useState(null);
  const [myAccounts, setMyAccounts] = useState([]);
  const [sourceId, setSourceId]     = useState("");

  // Step 2 — beneficiary entry
  const [accNumber, setAccNumber]   = useState("");
  const [bankName, setBankName]     = useState("NeuroBank");
  const [verifying, setVerifying]   = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [beneficiary, setBeneficiary] = useState(null); // { accountId, holderName, number, bankName, accountType, isSelf }

  // Step 3 — amount + note
  const [amount, setAmount]         = useState("");
  const [note, setNote]             = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]       = useState(null);
  const [transferError, setTransferError] = useState("");

  const accNumberRef = useRef(null);

  // ── Auth ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  const getToken = () => user?.getIdToken();

  // ── Load own accounts ──
  useEffect(() => {
    if (!user) return;
    (async () => {
      const t = await getToken();
      const res = await fetch("/api/accounts", { headers: { Authorization: `Bearer ${t}` } }).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) { setMyAccounts(data); setSourceId(data[0].id); }
    })();
  }, [user]);

  const sourceAccount = myAccounts.find((a) => a.id === sourceId);

  // ── Step 2: Verify beneficiary ──
  const handleVerify = async () => {
    if (!accNumber.trim()) { setVerifyError("Please enter an account number."); return; }
    setVerifyError("");
    setVerifying(true);
    setBeneficiary(null);
    try {
      const t = await getToken();
      const res = await fetch(`/api/accounts/verify?number=${encodeURIComponent(accNumber.trim())}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setBeneficiary(data);
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  // ── Step 3: Execute transfer ──
  const handleTransfer = async (e) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!sourceId)          { setTransferError("Select a source account."); return; }
    if (!beneficiary)       { setTransferError("Verify the beneficiary first."); return; }
    if (isNaN(parsed) || parsed <= 0) { setTransferError("Enter a valid amount."); return; }
    if (sourceAccount && parsed > sourceAccount.balance) { setTransferError("Insufficient funds."); return; }

    setTransferError("");
    setSubmitting(true);
    try {
      const t = await getToken();
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({
          fromAccountId: sourceId,
          toAccountId: beneficiary.accountId,
          amount: parsed,
          note: note || `Transfer to ${beneficiary.holderName}`,
        }),
      });
      const data = await res.json();

      // ── DACIS fraud block ──
      if (res.status === 403 && data.dacis?.blocked) {
        setTransferError(
          `🛡️ Transfer blocked by DACIS fraud detection — dg_score: ${data.dacis.dg_score?.toFixed(4)}` +
          (data.dacis.gate1_fired ? " | Gate 1 fired" : "") +
          (data.dacis.gate2_confirmed ? " | Gate 2 confirmed" : "") +
          ". Your account has been flagged for review."
        );
        // Redirect to frozen page after a short delay
        setTimeout(() => router.push("/dacis/frozen"), 3000);
        return;
      }

      if (!res.ok) throw new Error(data.message);

      setSuccess({ amount: parsed, to: beneficiary.holderName, newBalance: data.newBalance });

      // Refresh own accounts with fresh token
      const t2 = await getToken();
      const accsRes = await fetch("/api/accounts", { headers: { Authorization: `Bearer ${t2}` } });
      const accs = await accsRes.json();
      if (Array.isArray(accs)) { setMyAccounts(accs); }
    } catch (err) {
      setTransferError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetAll = () => {
    setAccNumber(""); setBankName("NeuroBank"); setBeneficiary(null);
    setVerifyError(""); setAmount(""); setNote("");
    setTransferError(""); setSuccess(null);
    if (myAccounts.length > 0) setSourceId(myAccounts[0].id);
    setTimeout(() => accNumberRef.current?.focus(), 100);
  };

  // Derived step state
  const step1Done = !!sourceId;
  const step2Done = !!beneficiary;
  const step3Active = step1Done && step2Done;

  // ── Success screen ──
  if (success) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="glass-panel rounded-2xl p-10 max-w-md w-full text-center ambient-glow relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-electric-blue to-transparent opacity-50" />
          <div className="w-16 h-16 rounded-full bg-electric-blue/20 border border-electric-blue/40 flex items-center justify-center mx-auto mb-6 shadow-[0_0_20px_rgba(255,107,0,0.3)]">
            <span className="material-symbols-outlined text-electric-blue text-[32px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          </div>
          <h2 className="text-headline-lg text-pure-white mb-2">Transfer Complete</h2>
          <p className="text-on-surface-variant text-body-md mb-6">
            <span className="text-electric-blue font-bold">{formatINR(success.amount)}</span> sent to <span className="text-pure-white">{success.to}</span>
          </p>
          {success.newBalance !== undefined && (
            <p className="text-label-sm text-on-surface-variant mb-8">
              New balance: <span className="text-on-surface font-mono">{formatINR(success.newBalance)}</span>
            </p>
          )}
          <button onClick={resetAll} className="w-full bg-electric-blue text-pure-white py-3 rounded-xl text-label-md uppercase tracking-widest hover:bg-primary-container transition-all shadow-[0_0_15px_rgba(255,107,0,0.3)]">
            New Transfer
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="mb-8 md:mb-10">
        <h1 className="text-headline-lg-mobile md:text-headline-lg text-pure-white">Money Movement</h1>
        <p className="text-body-md text-on-surface-variant mt-2">Enter the beneficiary&apos;s account details. We&apos;ll verify them before processing.</p>
      </header>

      {/* Step indicator */}
      <div className="flex items-center mb-10 max-w-lg">
        <Step n="1" label="Your Account"   active={!step1Done} done={step1Done} />
        <StepDivider done={step1Done} />
        <Step n="2" label="Beneficiary"    active={step1Done && !step2Done} done={step2Done} />
        <StepDivider done={step2Done} />
        <Step n="3" label="Amount & Send"  active={step3Active} done={false} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* ── LEFT: Source account selector ── */}
        <section className="lg:col-span-4 flex flex-col gap-4">
          <h2 className="text-label-md text-on-surface-variant uppercase tracking-wider">Step 1 — Debit From</h2>
          {myAccounts.map((acc) => (
            <button
              key={acc.id}
              type="button"
              onClick={() => setSourceId(acc.id)}
              className={`w-full text-left rounded-xl p-5 transition-all duration-200 ${
                sourceId === acc.id
                  ? "glass-panel-active shadow-[0_0_20px_rgba(255,107,0,0.15)]"
                  : "glass-panel hover:-translate-y-0.5"
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center border border-outline-variant/30">
                    <span className={`material-symbols-outlined text-[18px] ${acc.type === "savings" ? "text-on-surface-variant" : "text-primary"}`}>
                      {acc.type === "savings" ? "savings" : "account_balance"}
                    </span>
                  </div>
                  <div>
                    <p className="text-body-md text-pure-white font-medium">{acc.name}</p>
                    <p className="text-label-sm text-on-surface-variant font-mono">{acc.number}</p>
                  </div>
                </div>
                {sourceId === acc.id && (
                  <span className="w-2 h-2 rounded-full bg-electric-blue shadow-[0_0_6px_rgba(255,107,0,0.8)] mt-1.5 shrink-0" />
                )}
              </div>
              <p className="text-headline-md text-pure-white font-semibold">
                {formatINR(acc.balance || 0)}
              </p>
              <p className="text-label-sm text-on-surface-variant mt-0.5">Available Balance</p>
            </button>
          ))}
          {myAccounts.length === 0 && (
            <div className="glass-panel rounded-xl p-6 text-center text-on-surface-variant text-label-md">
              No accounts found
            </div>
          )}
        </section>

        {/* ── RIGHT: Beneficiary + Transfer form ── */}
        <section className="lg:col-span-8 flex flex-col gap-6">

          {/* ── Step 2: Beneficiary details ── */}
          <div className="glass-panel rounded-xl p-6 md:p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-electric-blue/5 rounded-full blur-[60px] pointer-events-none" />
            <h2 className="text-headline-md text-pure-white mb-1">Step 2 — Beneficiary Details</h2>
            <p className="text-label-sm text-on-surface-variant mb-6">Enter the payee&apos;s account number. We&apos;ll verify it before you can proceed.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Account Number */}
              <div className="md:col-span-2 space-y-2 group">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">Account Number</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors text-[20px]">
                    tag
                  </span>
                  <input
                    ref={accNumberRef}
                    type="text"
                    value={accNumber}
                    onChange={(e) => { setAccNumber(e.target.value); setBeneficiary(null); setVerifyError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                    placeholder="e.g. ****4920 or last 4 digits"
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                </div>
              </div>

              {/* Bank Name */}
              <div className="space-y-2 group">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">Bank Name</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors text-[20px]">
                    account_balance
                  </span>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="NeuroBank"
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                </div>
              </div>

              {/* IFSC / Routing (optional, cosmetic for now) */}
              <div className="space-y-2 group">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">IFSC / Routing Code <span className="text-outline normal-case">(optional)</span></label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors text-[20px]">
                    code
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. NROB0001234"
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                </div>
              </div>
            </div>

            {/* Verify error */}
            {verifyError && (
              <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-error-container/20 border border-error/30 text-error text-label-sm">
                <span className="material-symbols-outlined text-[16px]">error</span>
                {verifyError}
              </div>
            )}

            {/* Verified beneficiary card */}
            {beneficiary && (
              <div className="mt-5 flex items-center gap-4 p-4 rounded-xl bg-electric-blue/10 border border-electric-blue/30">
                <div className="w-10 h-10 rounded-full bg-electric-blue/20 border border-electric-blue/40 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-electric-blue text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified_user</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body-md text-pure-white font-semibold">{beneficiary.holderName}</p>
                  <p className="text-label-sm text-on-surface-variant font-mono">{beneficiary.number} · {beneficiary.bankName} · {beneficiary.accountType}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-label-sm text-electric-blue bg-electric-blue/10 border border-electric-blue/20 px-2 py-1 rounded-full">Verified</span>
                  {beneficiary.isSelf && (
                    <span className="text-label-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-1 rounded-full">Own Account</span>
                  )}
                </div>
              </div>
            )}

            {/* Verify button */}
            {!beneficiary && (
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying || !accNumber.trim() || !step1Done}
                className="mt-5 w-full md:w-auto px-8 py-3 rounded-xl bg-surface-container-high border border-outline-variant text-on-surface text-label-md hover:border-electric-blue/50 hover:text-pure-white transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verifying ? (
                  <><span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>Verifying...</>
                ) : (
                  <><span className="material-symbols-outlined text-[18px]">search</span>Verify Account</>
                )}
              </button>
            )}
            {beneficiary && (
              <button
                type="button"
                onClick={() => { setBeneficiary(null); setAccNumber(""); setVerifyError(""); }}
                className="mt-4 text-label-sm text-on-surface-variant hover:text-error transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
                Change beneficiary
              </button>
            )}
          </div>

          {/* ── Step 3: Amount & Send (locked until verified) ── */}
          <div className={`glass-panel rounded-xl p-6 md:p-8 relative overflow-hidden transition-opacity duration-300 ${step3Active ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-electric-blue/40 to-transparent" />
            <h2 className="text-headline-md text-pure-white mb-1">Step 3 — Amount & Confirm</h2>
            <p className="text-label-sm text-on-surface-variant mb-6">
              {step3Active
                ? `Sending to ${beneficiary?.holderName} · ${beneficiary?.number}`
                : "Complete steps 1 & 2 to unlock"}
            </p>

            <form onSubmit={handleTransfer} className="space-y-6">
              {/* Big amount input */}
              <div className="flex flex-col items-center justify-center py-6 border border-outline-variant/20 rounded-xl bg-surface-container-lowest/30 input-glow group">
                <label className="text-label-sm text-on-surface-variant mb-2 uppercase tracking-wider">Amount (INR)</label>
                <div className="flex items-center gap-1">
                  <span className="text-headline-xl text-on-surface-variant">₹</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, "");
                      if (val.split(".").length <= 2) setAmount(val);
                    }}
                    placeholder="0.00"
                    className="bg-transparent border-none text-center outline-none w-[180px] focus:ring-0 p-0 text-headline-xl text-pure-white placeholder:text-outline"
                  />
                </div>
                {sourceAccount && amount && parseFloat(amount) > 0 && (
                  <p className={`text-label-sm mt-2 ${parseFloat(amount) > sourceAccount.balance ? "text-error" : "text-on-surface-variant"}`}>
                    {parseFloat(amount) > sourceAccount.balance
                      ? "Exceeds available balance"
                      : `Remaining: ${formatINR(sourceAccount.balance - parseFloat(amount))}`}
                  </p>
                )}
              </div>

              {/* Note */}
              <div className="space-y-2 group">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">Remarks <span className="text-outline normal-case">(optional)</span></label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-electric-blue transition-colors text-[20px]">edit_note</span>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Rent for November"
                    maxLength={80}
                    className="w-full bg-surface-container-lowest/50 border-0 border-b border-outline-variant rounded-t px-4 py-3 pl-10 text-pure-white text-label-md placeholder-outline-variant focus:ring-0 input-glow transition-all duration-300"
                  />
                </div>
              </div>

              {/* Transfer summary */}
              {step3Active && amount && parseFloat(amount) > 0 && (
                <div className="p-4 rounded-xl bg-surface-container/50 border border-outline-variant/30 space-y-2 text-label-sm">
                  <div className="flex justify-between text-on-surface-variant">
                    <span>From</span>
                    <span className="text-on-surface font-mono">{sourceAccount?.name} · {sourceAccount?.number}</span>
                  </div>
                  <div className="flex justify-between text-on-surface-variant">
                    <span>To</span>
                    <span className="text-on-surface">{beneficiary?.holderName} · {beneficiary?.number}</span>
                  </div>
                  <div className="flex justify-between text-on-surface-variant border-t border-outline-variant/20 pt-2 mt-2">
                    <span>Amount</span>
                    <span className="text-electric-blue font-bold font-mono">{formatINR(parseFloat(amount))}</span>
                  </div>
                </div>
              )}

              {/* Transfer error */}
              {transferError && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-error-container/20 border border-error/30 text-error text-label-sm">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {transferError}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-end gap-4 pt-2">
                <button
                  type="button"
                  onClick={resetAll}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl border border-outline-variant text-on-surface-variant hover:text-pure-white hover:bg-surface-container transition-all text-label-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !step3Active || !amount || parseFloat(amount) <= 0}
                  className="w-full sm:w-auto px-8 py-3 rounded-xl bg-electric-blue text-pure-white hover:bg-primary-container hover:shadow-[0_0_20px_rgba(255,107,0,0.4)] transition-all text-label-md font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(255,107,0,0.25)]"
                >
                  {submitting ? (
                    <><span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>Processing...</>
                  ) : (
                    <><span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>send_money</span>Initiate Transfer</>
                  )}
                </button>
              </div>
            </form>
          </div>

        </section>
      </div>
    </>
  );
}
