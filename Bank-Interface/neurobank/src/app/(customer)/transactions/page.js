"use client";
import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/app/components/Toast";
import { formatINR } from "@/lib/money";

export default function TransactionsPage() {
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const filterRef = useRef(null);

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
    fetch("/api/transactions", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTransactions(data); })
      .catch(() => {});
  }, [token]);

  // Close filter dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilter(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Get unique categories
  const categories = [...new Set(transactions.map((t) => t.category).filter(Boolean))];

  // Filter transactions
  const filtered = transactions.filter((txn) => {
    const matchesSearch = !search || txn.name?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !filterCategory || txn.category?.toLowerCase() === filterCategory.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  // Export as CSV
  const exportCSV = () => {
    if (filtered.length === 0) { toast.error("No transactions to export"); return; }
    const headers = ["Date", "Name", "Category", "Card", "Amount"];
    const rows = filtered.map((t) => [
      t.createdAt?.slice(0, 10) || "",
      t.name || "",
      t.category || "",
      t.card || "",
      t.amount?.toFixed(2) || "0.00",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neurobank_transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} transactions`);
  };

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diff === 0) return `Today, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
    if (diff === 1) return `Yesterday, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <>
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-headline-lg-mobile md:text-headline-xl text-pure-white mb-2">Transaction History</h1>
          <p className="text-body-md text-on-surface-variant">Neural ledger of all financial movements.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Filter */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setShowFilter((o) => !o)}
              className={`glass-btn px-4 py-2 rounded-lg text-label-md flex items-center gap-2 ${filterCategory ? "text-electric-blue border-electric-blue/30" : "text-on-surface"}`}
            >
              <span className="material-symbols-outlined text-[18px]">filter_list</span>
              {filterCategory || "Filter"}
            </button>
            {showFilter && (
              <div className="absolute right-0 top-11 w-48 glass-modal rounded-lg overflow-hidden shadow-2xl z-50">
                <button
                  onClick={() => { setFilterCategory(""); setShowFilter(false); }}
                  className={`w-full text-left px-4 py-3 text-label-md transition-colors ${!filterCategory ? "text-electric-blue bg-electric-blue/10" : "text-on-surface-variant hover:bg-white/5"}`}
                >
                  All Categories
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setFilterCategory(cat); setShowFilter(false); }}
                    className={`w-full text-left px-4 py-3 text-label-md transition-colors ${filterCategory === cat ? "text-electric-blue bg-electric-blue/10" : "text-on-surface-variant hover:bg-white/5"}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Export */}
          <button onClick={exportCSV} className="glass-btn px-4 py-2 rounded-lg text-label-md text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">download</span> Export
          </button>
        </div>
      </header>

      {/* Search Bar */}
      <div className="glass-panel rounded-xl p-4 mb-8 flex items-center gap-3">
        <span className="material-symbols-outlined text-on-surface-variant">search</span>
        <input
          className="flex-1 bg-transparent border-none text-body-md text-pure-white placeholder:text-on-surface-variant focus:ring-0 focus:outline-none"
          placeholder="Search transactions..."
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
        <span className="text-label-sm text-on-surface-variant border border-outline-variant px-2 py-1 rounded">⌘K</span>
      </div>

      {/* Results count */}
      {(search || filterCategory) && (
        <div className="mb-4 text-label-sm text-on-surface-variant">
          Showing {filtered.length} of {transactions.length} transactions
          {filterCategory && <span className="ml-2 text-electric-blue">• {filterCategory}</span>}
        </div>
      )}

      {/* Transaction List */}
      <div className="glass-panel rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-on-surface-variant text-label-md">
            {transactions.length === 0 ? "No transactions yet" : "No matching transactions"}
          </div>
        ) : (
          filtered.map((txn, i) => (
            <div
              key={txn.id || i}
              onClick={() => setSelectedTxn(selectedTxn?.id === txn.id ? null : txn)}
              className="flex items-center justify-between p-5 hover:bg-surface-container-high/30 cursor-pointer transition-colors border-b border-outline-variant/10 last:border-0 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center border border-outline-variant/50 group-hover:border-electric-blue/50 transition-colors">
                  <span className={`material-symbols-outlined ${txn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>{txn.icon || "receipt"}</span>
                </div>
                <div>
                  <p className="text-body-md text-pure-white font-medium">{txn.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-label-sm text-on-surface-variant">{txn.category}</span>
                    <span className="text-[8px] text-outline">•</span>
                    <span className="text-label-sm text-on-surface-variant">{formatDate(txn.createdAt)}</span>
                    <span className="text-[8px] text-outline">•</span>
                    <span className="text-label-sm text-on-surface-variant font-mono">{txn.card}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-label-md font-mono ${txn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>
                  {txn.amount > 0 ? "+" : ""}{formatINR(Math.abs(txn.amount))}
                </span>
                <span className="material-symbols-outlined text-on-surface-variant text-[18px] opacity-0 group-hover:opacity-100 transition-opacity">chevron_right</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Transaction Detail Modal */}
      {selectedTxn && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-void-black/60 backdrop-blur-sm" onClick={() => setSelectedTxn(null)}>
          <div className="glass-modal rounded-2xl p-8 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-headline-md text-pure-white">Transaction Details</h3>
              <button onClick={() => setSelectedTxn(null)} className="text-on-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-4 pb-4 border-b border-white/5">
                <div className="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center border border-outline-variant/50">
                  <span className={`material-symbols-outlined text-[28px] ${selectedTxn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>{selectedTxn.icon || "receipt"}</span>
                </div>
                <div>
                  <p className="text-body-lg text-pure-white font-medium">{selectedTxn.name}</p>
                  <p className={`text-headline-md font-mono ${selectedTxn.amount > 0 ? "text-electric-blue glow-text" : "text-on-surface"}`}>
                    {selectedTxn.amount > 0 ? "+" : ""}{formatINR(Math.abs(selectedTxn.amount))}
                  </p>
                </div>
              </div>
              {[
                ["Category", selectedTxn.category],
                ["Date", formatDate(selectedTxn.createdAt)],
                ["Card/Method", selectedTxn.card],
                ["Account ID", selectedTxn.accountId?.slice(0, 12) + "..."],
                ["Transaction ID", selectedTxn.id?.slice(0, 12) + "..."],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-label-sm text-on-surface-variant">{label}</span>
                  <span className="text-label-md text-on-surface font-mono">{value || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
