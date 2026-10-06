"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { formatINR } from "@/lib/money";

export default function ProfilePage() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) return;
      const nextToken = await currentUser.getIdToken();
      setToken(nextToken);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch("/api/accounts", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch("/api/transactions", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    ])
      .then(([me, accs, txns]) => {
        setUser(me);
        if (Array.isArray(accs)) setAccounts(accs);
        if (Array.isArray(txns)) setTransactions(txns);
      })
      .catch(() => {});
  }, [token]);

  const displayName = user?.name || auth.currentUser?.displayName || "User";
  const email = user?.email || auth.currentUser?.email || "";
  const tier = user?.tier || "Standard";
  const role = user?.role || "customer";
  const totalBalance = accounts.reduce((sum, account) => sum + (account.balance || 0), 0);
  const recentTransactions = [...transactions].slice(0, 5);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="glass-panel rounded-3xl p-8 md:p-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-electric-blue/10 via-transparent to-primary/10 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <p className="text-label-md uppercase tracking-[0.25em] text-on-surface-variant mb-3">Customer Profile</p>
            <h1 className="text-headline-xl text-pure-white">{displayName}</h1>
            <p className="text-body-md text-on-surface-variant mt-2">Your banking identity, account summary, and latest activity in one place.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className="px-3 py-1 rounded-full border border-electric-blue/30 bg-electric-blue/10 text-electric-blue text-label-sm">{tier}</span>
            <span className="px-3 py-1 rounded-full border border-outline-variant bg-surface-container/30 text-on-surface text-label-sm">{role}</span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-panel rounded-2xl p-6 lg:col-span-1">
          <div className="w-20 h-20 rounded-full bg-electric-blue/15 border border-electric-blue/30 flex items-center justify-center text-headline-md text-electric-blue font-bold mb-4">
            {displayName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <p className="text-label-md text-on-surface-variant uppercase tracking-widest mb-1">Email</p>
          <p className="text-body-md text-pure-white break-all mb-4">{email || "—"}</p>
          <p className="text-label-md text-on-surface-variant uppercase tracking-widest mb-1">Member Since</p>
          <p className="text-body-md text-pure-white">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—"}</p>
        </div>

        <div className="glass-panel rounded-2xl p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-label-md text-on-surface-variant uppercase tracking-widest">Net Worth</p>
              <h2 className="text-headline-lg text-pure-white mt-1">{formatINR(totalBalance)}</h2>
            </div>
            <span className="material-symbols-outlined text-[28px] text-electric-blue">account_balance_wallet</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {accounts.length > 0 ? accounts.map((account) => (
              <div key={account.id} className="rounded-xl border border-outline-variant/30 bg-surface-container/20 p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-body-md text-pure-white">{account.name}</p>
                    <p className="text-label-sm text-on-surface-variant font-mono">{account.number}</p>
                  </div>
                  <span className="text-label-sm px-2 py-1 rounded-full bg-electric-blue/10 text-electric-blue border border-electric-blue/20 uppercase">{account.type}</span>
                </div>
                <p className="text-headline-md text-electric-blue">{formatINR(account.balance)}</p>
              </div>
            )) : (
              <div className="text-on-surface-variant text-label-md">No accounts available yet.</div>
            )}
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-label-md text-on-surface-variant uppercase tracking-widest">Latest Activity</p>
            <h2 className="text-headline-md text-pure-white mt-1">Recent Transactions</h2>
          </div>
          <a href="/transactions" className="text-label-md text-electric-blue hover:text-primary transition-colors">View all</a>
        </div>
        <div className="space-y-3">
          {recentTransactions.length > 0 ? recentTransactions.map((txn) => (
            <div key={txn.id} className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/20 bg-surface-container/20 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
                  <span className={`material-symbols-outlined ${txn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>{txn.icon || "receipt"}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-body-md text-pure-white truncate">{txn.name}</p>
                  <p className="text-label-sm text-on-surface-variant">{txn.category || "Activity"}</p>
                </div>
              </div>
              <span className={`text-label-md font-mono ${txn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>
                {txn.amount > 0 ? "+" : ""}{formatINR(Math.abs(txn.amount))}
              </span>
            </div>
          )) : (
            <div className="text-on-surface-variant text-label-md">No recent activity yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
