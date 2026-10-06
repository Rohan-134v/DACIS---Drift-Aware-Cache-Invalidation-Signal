"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/app/components/Toast";
import { formatINR } from "@/lib/money";

const LOAN_TYPES = [
  { key: "home",     icon: "house",          label: "Home Loan",       rate: 3.75 },
  { key: "auto",     icon: "directions_car", label: "Auto Loan",       rate: 4.25 },
  { key: "education",icon: "school",         label: "Education Loan",  rate: 3.50 },
  { key: "business", icon: "business",       label: "Business Loan",   rate: 5.00 },
  { key: "personal", icon: "person",         label: "Personal Loan",   rate: 6.50 },
];

const STATUS_STYLES = {
  pending:  "bg-tertiary/10 border-tertiary/30 text-tertiary",
  active:   "bg-electric-blue/10 border-electric-blue/30 text-electric-blue",
  rejected: "bg-error/10 border-error/30 text-error",
  closed:   "bg-surface-variant border-outline-variant text-on-surface-variant",
};

function calcEmi(principal, annualRate, months) {
  const r = annualRate / 100 / 12;
  if (r === 0) return Math.round((principal / months) * 100) / 100;
  return Math.round((principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1) * 100) / 100;
}

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="glass-panel rounded-xl p-6 w-full max-w-md mx-4 border border-outline-variant">
      <div className="flex justify-between items-center mb-5">
        <h3 className="text-body-lg text-pure-white">{title}</h3>
        <button onClick={onClose} className="text-on-surface-variant hover:text-pure-white">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      {children}
    </div>
  </div>
);

export default function LoansPage() {
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [loans, setLoans] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLoan, setSelectedLoan] = useState(null);

  const [applyModal, setApplyModal] = useState(false);
  const [applyForm, setApplyForm] = useState({ type: "personal", amount: "", tenureMonths: "12", purpose: "" });
  const [applyLoading, setApplyLoading] = useState(false);

  const [emiModal, setEmiModal] = useState(false);
  const [emiForm, setEmiForm] = useState({ accountId: "", dayOfMonth: "1" });
  const [emiLoading, setEmiLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      const t = await user.getIdToken();
      setToken(t);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetch("/api/loans", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch("/api/accounts", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([loansData, accData]) => {
      if (Array.isArray(loansData)) setLoans(loansData);
      if (Array.isArray(accData)) setAccounts(accData);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  const api = (path, opts = {}) =>
    fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });

  const handleApply = async () => {
    setApplyLoading(true);
    try {
      const res = await api("/api/loans", { method: "POST", body: JSON.stringify(applyForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setLoans(prev => [data, ...prev]);
      setApplyModal(false);
      setApplyForm({ type: "personal", amount: "", tenureMonths: "12", purpose: "" });
      toast.success("Loan application submitted! Awaiting admin approval.");
    } catch (err) { toast.error(err.message || "Failed"); }
    setApplyLoading(false);
  };

  const handleSetupEmi = async () => {
    if (!selectedLoan) return;
    setEmiLoading(true);
    try {
      const res = await api(`/api/loans/${selectedLoan.id}/emi-autopay`, { method: "POST", body: JSON.stringify(emiForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const updated = { ...selectedLoan, emiAutopay: data.emiAutopay };
      setLoans(prev => prev.map(l => l.id === selectedLoan.id ? updated : l));
      setSelectedLoan(updated);
      setEmiModal(false);
      toast.success("EMI autopay set up successfully.");
    } catch (err) { toast.error(err.message || "Failed"); }
    setEmiLoading(false);
  };

  const handleCancelEmi = async (loan) => {
    try {
      const res = await api(`/api/loans/${loan.id}/emi-autopay`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const updated = { ...loan, emiAutopay: null };
      setLoans(prev => prev.map(l => l.id === loan.id ? updated : l));
      if (selectedLoan?.id === loan.id) setSelectedLoan(updated);
      toast.success("EMI autopay cancelled.");
    } catch (err) { toast.error(err.message || "Failed"); }
  };

  const previewEmi = calcEmi(
    parseFloat(applyForm.amount) || 0,
    LOAN_TYPES.find(t => t.key === applyForm.type)?.rate || 0,
    parseInt(applyForm.tenureMonths) || 1
  );

  const activeLoans = loans.filter(l => l.status === "active");
  const pendingLoans = loans.filter(l => l.status === "pending");

  if (loading) return <div className="flex items-center justify-center h-64"><span className="text-on-surface-variant">Loading...</span></div>;

  return (
    <>
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-headline-lg-mobile md:text-headline-xl text-pure-white mb-2">Loans & Credit</h1>
          <p className="text-body-md text-on-surface-variant">Apply for loans and manage your repayments.</p>
        </div>
        <button onClick={() => setApplyModal(true)}
          className="flex items-center justify-center gap-2 bg-electric-blue text-pure-white px-6 py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors shadow-[0_0_15px_rgba(13,23,231,0.3)]">
          <span className="material-symbols-outlined">request_quote</span>
          Apply for Loan
        </button>
      </header>

      {/* Active Loans */}
      {activeLoans.length > 0 && (
        <div className="mb-8">
          <h2 className="text-headline-md text-pure-white mb-4">Active Loans</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
            {activeLoans.map(loan => {
              const type = LOAN_TYPES.find(t => t.key === loan.type);
              const progress = Math.round(((loan.amount - loan.outstanding) / loan.amount) * 100);
              return (
                <div key={loan.id} onClick={() => setSelectedLoan(loan)}
                  className="glass-panel rounded-xl p-6 cursor-pointer hover:border-primary/30 transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-electric-blue/10 border border-electric-blue/20 flex items-center justify-center text-electric-blue">
                        <span className="material-symbols-outlined">{type?.icon}</span>
                      </div>
                      <div>
                        <h3 className="text-body-md text-pure-white">{type?.label}</h3>
                        <p className="text-label-sm text-on-surface-variant">{loan.interestRate}% p.a.</p>
                      </div>
                    </div>
                    <span className={`text-label-sm px-3 py-1 rounded-full border ${STATUS_STYLES[loan.status]}`}>Active</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-label-xs text-on-surface-variant">Outstanding</p>
                      <p className="text-body-md text-pure-white font-mono">{formatINR(loan.outstanding)}</p>
                    </div>
                    <div>
                      <p className="text-label-xs text-on-surface-variant">Monthly EMI</p>
                      <p className="text-body-md text-electric-blue font-mono">{formatINR(loan.emi)}</p>
                    </div>
                    <div>
                      <p className="text-label-xs text-on-surface-variant">Tenure</p>
                      <p className="text-body-md text-pure-white">{loan.tenureMonths} mo</p>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-label-xs text-on-surface-variant mb-1">
                      <span>Repayment Progress</span><span className="text-electric-blue">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                      <div className="h-full bg-electric-blue rounded-full transition-all" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                  {loan.emiAutopay ? (
                    <div className="mt-3 flex items-center justify-between text-label-xs">
                      <span className="text-electric-blue flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">autorenew</span> EMI Autopay active · Day {loan.emiAutopay.dayOfMonth}</span>
                      <button onClick={(e) => { e.stopPropagation(); handleCancelEmi(loan); }} className="text-error hover:text-error/80">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setSelectedLoan(loan); setEmiForm({ accountId: accounts[0]?.id || "", dayOfMonth: "1" }); setEmiModal(true); }}
                      className="mt-3 w-full text-label-sm text-primary border border-primary/20 rounded-lg py-2 hover:bg-primary/5 transition-colors flex items-center justify-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">autorenew</span> Set Up EMI Autopay
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending Loans */}
      {pendingLoans.length > 0 && (
        <div className="mb-8">
          <h2 className="text-headline-md text-pure-white mb-4">Pending Applications</h2>
          <div className="space-y-3">
            {pendingLoans.map(loan => {
              const type = LOAN_TYPES.find(t => t.key === loan.type);
              return (
                <div key={loan.id} className="glass-panel rounded-xl px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined text-tertiary">{type?.icon}</span>
                    <div>
                      <p className="text-body-md text-pure-white">{type?.label} — {formatINR(loan.amount)}</p>
                      <p className="text-label-sm text-on-surface-variant">{loan.tenureMonths} months · {loan.interestRate}% p.a. · EMI {formatINR(loan.emi)}</p>
                    </div>
                  </div>
                  <span className={`text-label-sm px-3 py-1 rounded-full border ${STATUS_STYLES.pending}`}>Pending Review</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rejected / Closed */}
      {loans.filter(l => l.status === "rejected" || l.status === "closed").length > 0 && (
        <div className="mb-8">
          <h2 className="text-headline-md text-pure-white mb-4">Past Applications</h2>
          <div className="space-y-3">
            {loans.filter(l => l.status === "rejected" || l.status === "closed").map(loan => {
              const type = LOAN_TYPES.find(t => t.key === loan.type);
              return (
                <div key={loan.id} className="glass-panel rounded-xl px-5 py-4 flex items-center justify-between opacity-70">
                  <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined text-on-surface-variant">{type?.icon}</span>
                    <div>
                      <p className="text-body-md text-pure-white">{type?.label} — {formatINR(loan.amount)}</p>
                      {loan.rejectionReason && <p className="text-label-sm text-error mt-0.5">{loan.rejectionReason}</p>}
                    </div>
                  </div>
                  <span className={`text-label-sm px-3 py-1 rounded-full border ${STATUS_STYLES[loan.status]}`}>
                    {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loan Products (when no loans) */}
      {loans.length === 0 && (
        <div className="md:col-span-12">
          <h3 className="text-headline-md text-pure-white mb-6">Explore Loan Products</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-gutter">
            {LOAN_TYPES.map(product => (
              <div key={product.key} onClick={() => { setApplyForm(f => ({ ...f, type: product.key })); setApplyModal(true); }}
                className="glass-panel rounded-xl p-6 hover:border-primary/30 transition-all cursor-pointer group">
                <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center mb-4 border border-outline-variant/30 group-hover:border-electric-blue/50 transition-colors">
                  <span className="material-symbols-outlined text-primary">{product.icon}</span>
                </div>
                <h4 className="text-body-md text-pure-white mb-1">{product.label}</h4>
                <p className="text-label-sm text-electric-blue">from {product.rate}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loan Detail Side Panel */}
      {selectedLoan && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm" onClick={() => setSelectedLoan(null)}>
          <div className="w-full max-w-md bg-surface-container h-full overflow-y-auto p-6 border-l border-outline-variant" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-headline-md text-pure-white">Loan Details</h2>
              <button onClick={() => setSelectedLoan(null)} className="text-on-surface-variant hover:text-pure-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {(() => {
              const type = LOAN_TYPES.find(t => t.key === selectedLoan.type);
              const progress = Math.round(((selectedLoan.amount - selectedLoan.outstanding) / selectedLoan.amount) * 100);
              return (
                <>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-full bg-electric-blue/10 border border-electric-blue/20 flex items-center justify-center text-electric-blue">
                      <span className="material-symbols-outlined text-[24px]">{type?.icon}</span>
                    </div>
                    <div>
                      <h3 className="text-body-lg text-pure-white">{type?.label}</h3>
                      <span className={`text-label-sm px-2 py-0.5 rounded-full border ${STATUS_STYLES[selectedLoan.status]}`}>
                        {selectedLoan.status.charAt(0).toUpperCase() + selectedLoan.status.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {[
                      ["Loan Amount", formatINR(selectedLoan.amount)],
                      ["Outstanding", formatINR(selectedLoan.outstanding)],
                      ["Monthly EMI", formatINR(selectedLoan.emi)],
                      ["Interest Rate", `${selectedLoan.interestRate}% p.a.`],
                      ["Tenure", `${selectedLoan.tenureMonths} months`],
                      ["Paid Months", `${selectedLoan.paidMonths || 0}`],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3">
                        <p className="text-label-xs text-on-surface-variant mb-1">{label}</p>
                        <p className="text-body-md text-pure-white font-mono">{value}</p>
                      </div>
                    ))}
                  </div>
                  {selectedLoan.purpose && (
                    <div className="bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 mb-6">
                      <p className="text-label-xs text-on-surface-variant mb-1">Purpose</p>
                      <p className="text-body-md text-pure-white">{selectedLoan.purpose}</p>
                    </div>
                  )}
                  {selectedLoan.status === "active" && (
                    <div className="mb-6">
                      <div className="flex justify-between text-label-sm text-on-surface-variant mb-2">
                        <span>Repayment Progress</span><span className="text-electric-blue">{progress}%</span>
                      </div>
                      <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                        <div className="h-full bg-electric-blue rounded-full" style={{ width: `${progress}%` }}></div>
                      </div>
                    </div>
                  )}
                  {selectedLoan.status === "active" && (
                    <div className="border border-outline-variant rounded-xl p-4">
                      <h4 className="text-body-md text-pure-white mb-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-[18px]">autorenew</span> EMI Autopay
                      </h4>
                      {selectedLoan.emiAutopay ? (
                        <div>
                          <p className="text-label-sm text-on-surface-variant mb-1">
                            Deducted on day <span className="text-pure-white">{selectedLoan.emiAutopay.dayOfMonth}</span> of every month
                          </p>
                          <p className="text-label-sm text-on-surface-variant mb-4">
                            From: <span className="text-pure-white">{accounts.find(a => a.id === selectedLoan.emiAutopay.accountId)?.name || selectedLoan.emiAutopay.accountId}</span>
                          </p>
                          <button onClick={() => handleCancelEmi(selectedLoan)}
                            className="w-full text-error border border-error/30 bg-error/5 hover:bg-error/10 rounded-lg py-2 text-label-sm transition-colors">
                            Cancel Autopay
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setEmiForm({ accountId: accounts[0]?.id || "", dayOfMonth: "1" }); setEmiModal(true); }}
                          className="w-full bg-electric-blue text-pure-white py-2 rounded-lg text-label-sm hover:bg-inverse-primary transition-colors">
                          Set Up EMI Autopay
                        </button>
                      )}
                    </div>
                  )}
                  {selectedLoan.status === "rejected" && selectedLoan.rejectionReason && (
                    <div className="bg-error/5 border border-error/20 rounded-lg px-4 py-3">
                      <p className="text-label-sm text-error">{selectedLoan.rejectionReason}</p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Apply Modal */}
      {applyModal && (
        <Modal title="Apply for a Loan" onClose={() => setApplyModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-label-sm text-on-surface-variant mb-1 block">Loan Type</label>
              <select value={applyForm.type} onChange={e => setApplyForm(f => ({ ...f, type: e.target.value }))}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md focus:outline-none focus:border-primary">
                {LOAN_TYPES.map(t => <option key={t.key} value={t.key}>{t.label} — {t.rate}% p.a.</option>)}
              </select>
            </div>
            <div>
              <label className="text-label-sm text-on-surface-variant mb-1 block">Loan Amount (INR)</label>
              <input type="number" min="1000" placeholder="e.g. 50000" value={applyForm.amount}
                onChange={e => setApplyForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-label-sm text-on-surface-variant mb-1 block">Tenure (months)</label>
              <input type="number" min="1" max="360" placeholder="e.g. 60" value={applyForm.tenureMonths}
                onChange={e => setApplyForm(f => ({ ...f, tenureMonths: e.target.value }))}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-label-sm text-on-surface-variant mb-1 block">Purpose (optional)</label>
              <input type="text" placeholder="e.g. Home renovation" value={applyForm.purpose}
                onChange={e => setApplyForm(f => ({ ...f, purpose: e.target.value }))}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md focus:outline-none focus:border-primary" />
            </div>
            {applyForm.amount && applyForm.tenureMonths && (
              <div className="bg-electric-blue/5 border border-electric-blue/20 rounded-lg px-4 py-3 flex justify-between items-center">
                <span className="text-label-sm text-on-surface-variant">Estimated Monthly EMI</span>
                <span className="text-body-md text-electric-blue font-mono">{formatINR(previewEmi)}</span>
              </div>
            )}
            <button onClick={handleApply} disabled={applyLoading || !applyForm.amount || !applyForm.tenureMonths}
              className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors disabled:opacity-50 mt-2">
              {applyLoading ? "Submitting..." : "Submit Application"}
            </button>
          </div>
        </Modal>
      )}

      {/* EMI Autopay Modal */}
      {emiModal && (
        <Modal title="Set Up EMI Autopay" onClose={() => setEmiModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="text-label-sm text-on-surface-variant mb-1 block">Deduct from Account</label>
              <select value={emiForm.accountId} onChange={e => setEmiForm(f => ({ ...f, accountId: e.target.value }))}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md focus:outline-none focus:border-primary">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {formatINR(a.balance)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-label-sm text-on-surface-variant mb-1 block">Day of Month</label>
              <input type="number" min="1" max="28" value={emiForm.dayOfMonth}
                onChange={e => setEmiForm(f => ({ ...f, dayOfMonth: e.target.value }))}
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md focus:outline-none focus:border-primary" />
            </div>
            <div className="bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 flex justify-between">
              <span className="text-label-sm text-on-surface-variant">EMI Amount</span>
              <span className="text-body-md text-electric-blue font-mono">{formatINR(selectedLoan?.emi)}</span>
            </div>
            <button onClick={handleSetupEmi} disabled={emiLoading || !emiForm.accountId}
              className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors disabled:opacity-50">
              {emiLoading ? "Setting up..." : "Confirm Autopay"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
