"use client";
import { useState, useEffect } from "react";
import { useToast } from "@/app/components/Toast";
import { formatINR } from "@/lib/money";

export default function FixedDepositsPage() {
  const toast = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDeposits = async () => {
    try {
      const token = localStorage.getItem("nb_token");
      const res = await fetch("/api/fixed-deposits", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setDeposits(data);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load fixed deposits");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeposits();
  }, []);

  const handleCreateFD = async (e) => {
    e.preventDefault();
    const vaultType = e.target.vaultType.value;
    const amount = e.target.amount.value;
    const duration = e.target.duration.value;

    try {
      const token = localStorage.getItem("nb_token");
      const res = await fetch("/api/fixed-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vaultType, amount, duration }),
      });
      if (res.ok) {
        setIsModalOpen(false);
        toast.success("New Fixed Deposit successfully initiated!");
        fetchDeposits();
      } else {
        toast.error("Failed to create FD");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to create FD");
    }
  };

  const totalInvested = deposits.reduce((sum, d) => sum + d.principal, 0);
  const totalInterest = deposits.reduce((sum, d) => sum + d.interest, 0);
  const avgRate = (deposits.reduce((sum, d) => sum + parseFloat(d.rate), 0) / deposits.length).toFixed(2);

  return (
    <>
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-headline-lg-mobile md:text-headline-xl text-pure-white mb-2">Fixed Deposits</h1>
          <p className="text-body-md text-on-surface-variant">Lock capital in quantum-yield vaults for optimized returns.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 bg-electric-blue text-pure-white px-6 py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors shadow-[0_0_15px_rgba(13,23,231,0.3)]"
        >
          <span className="material-symbols-outlined">add_circle</span>
          Create New FD
        </button>
      </header>

      {/* Stats Row — computed from data */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter mb-10">
        <div className="glass-panel rounded-xl p-6">
          <span className="text-label-sm text-on-surface-variant uppercase">Total Invested</span>
          <p className="text-headline-md text-pure-white mt-2 glow-text">{formatINR(totalInvested, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="glass-panel rounded-xl p-6">
          <span className="text-label-sm text-on-surface-variant uppercase">Total Interest Earned</span>
          <p className="text-headline-md text-electric-blue mt-2 glow-text">{formatINR(totalInterest)}</p>
        </div>
        <div className="glass-panel rounded-xl p-6">
          <span className="text-label-sm text-on-surface-variant uppercase">Avg. Rate</span>
          <p className="text-headline-md text-pure-white mt-2">{avgRate}%</p>
        </div>
      </div>

      {/* FD List */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="grid grid-cols-6 p-4 border-b border-outline-variant/30 text-label-sm text-on-surface-variant">
          <span>Vault Name</span><span>Maturity</span><span>Rate</span><span>Principal</span><span>Interest</span><span>Status</span>
        </div>
        {deposits.map((fd, i) => (
          <div
            key={i}
            onClick={() => toast.info(`${fd.name}: ${formatINR(fd.principal)} @ ${fd.rate} · Matures ${fd.maturity}`)}
            className="grid grid-cols-6 p-4 items-center hover:bg-surface-container-high/30 cursor-pointer transition-colors border-b border-outline-variant/10 last:border-0"
          >
            <span className="text-body-md text-pure-white font-medium">{fd.name}</span>
            <span className="text-label-md text-on-surface-variant">{fd.maturity}</span>
            <span className="text-label-md text-electric-blue">{fd.rate}</span>
            <span className="text-label-md text-on-surface">{formatINR(fd.principal)}</span>
            <span className="text-label-md text-electric-blue">{formatINR(fd.interest)}</span>
            <span className={`text-label-sm px-2 py-1 rounded-full w-fit ${fd.status === "Active" ? "bg-electric-blue/10 text-electric-blue border border-electric-blue/20" : "bg-tertiary-container/30 text-tertiary border border-tertiary/20"}`}>{fd.status}</span>
          </div>
        ))}
      </div>

      {/* Create New FD Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void-black/80 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-md rounded-2xl p-8 relative shadow-2xl border border-outline-variant/30 animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-on-surface-variant hover:text-pure-white transition-colors"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <h2 className="text-headline-md text-pure-white mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-electric-blue">account_balance</span>
              Create Fixed Deposit
            </h2>
            <p className="text-body-md text-on-surface-variant mb-6">Initialize a new quantum-yield vault.</p>
            
            <form onSubmit={handleCreateFD} className="space-y-5">
              <div className="space-y-2">
                <label className="text-label-sm text-on-surface-variant uppercase">Vault Type</label>
                <select name="vaultType" className="w-full bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg px-4 py-3 text-pure-white text-body-md focus:outline-none focus:border-electric-blue transition-colors appearance-none">
                  <option value="shield">Shield Tier I (5.25%)</option>
                  <option value="quantum">Quantum Yield (5.50%)</option>
                  <option value="deep">Deep Vault Secure (4.75%)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-label-sm text-on-surface-variant uppercase">Amount (INR)</label>
                <input
                  name="amount"
                  type="number"
                  required
                  min="1000"
                  placeholder="10,000"
                  className="w-full bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg px-4 py-3 text-pure-white text-body-md focus:outline-none focus:border-electric-blue transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-label-sm text-on-surface-variant uppercase">Duration (Months)</label>
                <select name="duration" className="w-full bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg px-4 py-3 text-pure-white text-body-md focus:outline-none focus:border-electric-blue transition-colors appearance-none">
                  <option value="6">6 Months</option>
                  <option value="12">12 Months</option>
                  <option value="24">24 Months</option>
                  <option value="60">60 Months</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full mt-4 bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors shadow-[0_0_15px_rgba(13,23,231,0.3)]"
              >
                Confirm Allocation
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
