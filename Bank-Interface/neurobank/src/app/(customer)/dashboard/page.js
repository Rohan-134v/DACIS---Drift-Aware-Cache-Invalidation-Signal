"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/app/components/Toast";
import { formatINR } from "@/lib/money";
import { fetchJsonWithRetry } from "@/lib/fetch-json";

export default function DashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [userName, setUserName] = useState("User");
  const [isFlagged, setIsFlagged] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [dateRange, setDateRange] = useState("30d");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [goalTarget, setGoalTarget] = useState(10000);
  const [activeChartPoint, setActiveChartPoint] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 12, y: 12 });

  const defaultWidgets = {
    aiInsight: true,
    balanceOverview: true,
    monthlyGoal: true,
    spending: true,
    recentTxns: true,
    passbook: true, // The requested bank details card
    quickTransfer: true,
  };
  const [widgets, setWidgets] = useState(defaultWidgets);
  const [showWidgetModal, setShowWidgetModal] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("nb_widgets");
    if (saved) {
      try { setWidgets(JSON.parse(saved)); } catch (e) {}
    }
    const savedGoal = localStorage.getItem("nb_monthly_goal");
    if (savedGoal) {
      const parsed = Number(savedGoal);
      if (!Number.isNaN(parsed) && parsed > 0) setGoalTarget(parsed);
    }
  }, []);

  const toggleWidget = (key) => {
    const newWidgets = { ...widgets, [key]: !widgets[key] };
    setWidgets(newWidgets);
    localStorage.setItem("nb_widgets", JSON.stringify(newWidgets));
  };

  const updateGoalTarget = (nextValue) => {
    const parsed = Number(nextValue);
    if (Number.isNaN(parsed) || parsed <= 0) return;
    setGoalTarget(parsed);
    localStorage.setItem("nb_monthly_goal", String(parsed));
  };


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
    const loadData = () => Promise.all([
      fetchJsonWithRetry("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } }),
      fetchJsonWithRetry("/api/accounts", { headers: { Authorization: `Bearer ${token}` } }),
      fetchJsonWithRetry("/api/transactions", { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(([userRes, accsRes, txnsRes]) => {
      const user = userRes?.data;
      const accs = accsRes?.data;
      const txns = txnsRes?.data;
      if (user?.name) setUserName(user.name.split(" ")[0]);
      if (user?.dacis_flagged) {
        setIsFlagged(true);
        setFlagReason(user.dacis_reason || "Unspecified anomaly detected.");
      } else {
        setIsFlagged(false);
        setFlagReason("");
      }
      if (Array.isArray(accs)) setAccounts(accs);
      if (Array.isArray(txns)) setTransactions(txns);
    }).catch(() => {});
    loadData();
    const interval = setInterval(loadData, 15000);
    const handleFocus = () => loadData();
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [token]);

  const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const currentMonthTransactions = transactions.filter((txn) => {
    if (!txn.createdAt) return false;
    const createdAt = new Date(txn.createdAt);
    return createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear;
  });
  const chartRangeDays = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
  const chartStartDate = new Date();
  chartStartDate.setHours(0, 0, 0, 0);
  chartStartDate.setDate(chartStartDate.getDate() - chartRangeDays + 1);
  const chartRangeTransactions = transactions.filter((txn) => {
    if (!txn.createdAt || txn.amount >= 0) return false;
    const createdAt = new Date(txn.createdAt);
    return createdAt >= chartStartDate;
  });

  // Spending by category
  const spendingByCategory = {};
  currentMonthTransactions.forEach((txn) => {
    if (txn.amount < 0 && txn.category) {
      spendingByCategory[txn.category] = (spendingByCategory[txn.category] || 0) + Math.abs(txn.amount);
    }
  });
  const topCategories = Object.entries(spendingByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxSpending = topCategories.length > 0 ? Math.max(...topCategories.map(([, v]) => v)) : 1;

  // Monthly income & spending for goal
  const monthlyIncome = currentMonthTransactions
    .filter((t) => t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
  const monthlySpending = currentMonthTransactions
    .filter((t) => t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const monthlySaved = monthlyIncome - monthlySpending;
  const goalPct = Math.min(100, Math.max(0, Math.round((monthlySaved / goalTarget) * 100)));
  const strokeDashoffset = 251.2 - (251.2 * goalPct) / 100;

  // Balance trend — compute change percentage for the current month
  const monthlyNet = monthlyIncome - monthlySpending;
  const changePct = monthlySpending > 0 ? ((monthlyNet / monthlySpending) * 100).toFixed(1) : (monthlyNet > 0 ? "100.0" : "0.0");
  const isPositive = parseFloat(changePct) >= 0;

  // Generate SVG path from current-month transactions
  const generateChartPath = () => {
    if (chartRangeTransactions.length === 0) return { line: "M0 24 L100 24", area: "M0 24 L100 24 L100 30 L0 30 Z", points: [] };

    const weekCount = Math.max(1, Math.ceil(chartRangeDays / 7));
    const weeklyExpenses = Array.from({ length: weekCount }, () => 0);
    chartRangeTransactions.forEach((txn) => {
      const createdAt = new Date(txn.createdAt);
      const index = Math.floor((createdAt.getTime() - chartStartDate.getTime()) / 604800000);
      if (index >= 0 && index < weekCount) weeklyExpenses[index] += Math.abs(txn.amount);
    });

    const points = weeklyExpenses.map((value, index) => ({
      x: weekCount === 1 ? 0 : (index / (weekCount - 1)) * 100,
      y: value,
    }));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const range = maxY - minY || 1;
    const normalized = points.map((p, index) => {
      const y = 28 - ((p.y - minY) / range) * 25;
      const weekStart = new Date(chartStartDate);
      weekStart.setDate(chartStartDate.getDate() + (index * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      return {
        day: index + 1,
        x: p.x,
        y,
        value: weeklyExpenses[index],
        label: `${weekStart.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} - ${weekEnd.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`,
      };
    });
    const line = normalized.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const area = `${line} L100 30 L0 30 Z`;
    return { line, area, points: normalized };
  };
  const chart = generateChartPath();

  useEffect(() => {
    setActiveChartPoint(null);
  }, [dateRange]);

  const handleChartMove = (event) => {
    if (chart.points.length === 0) return;
    const shell = event.currentTarget.closest(".dashboard-chart-shell") || event.currentTarget;
    const rect = shell.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const clampedX = Math.max(0, Math.min(100, xRatio * 100));
    const nearest = chart.points.reduce((best, point) => {
      if (!best) return point;
      return Math.abs(point.x - clampedX) < Math.abs(best.x - clampedX) ? point : best;
    }, null);

    setActiveChartPoint(nearest);
    setTooltipPos({
      x: Math.max(12, Math.min(rect.width - 12, event.clientX - rect.left)),
      y: Math.max(8, (event.clientY - rect.top) - 12),
    });
  };

  const recentTxns = transactions.slice(0, 3);
  const currentMonthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date());

  const dateLabels = { "7d": "Last 7 Days", "30d": "Last 30 Days", "90d": "Last 90 Days" };

  return (
    <>
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-headline-xl text-on-surface">Overview</h1>
          <p className="text-body-lg text-on-surface-variant mt-1">Welcome back, {userName}. Your neural net is synced.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Range Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDatePicker((o) => !o)}
              className="glass-btn px-4 py-2 rounded-lg text-label-md text-on-surface flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">calendar_month</span>
              {dateLabels[dateRange]}
              <span className="material-symbols-outlined text-[18px]">expand_more</span>
            </button>
            {showDatePicker && (
              <div className="absolute right-0 top-11 w-48 glass-modal rounded-lg overflow-hidden shadow-2xl z-50">
                {Object.entries(dateLabels).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setDateRange(key); setShowDatePicker(false); }}
                    className={`w-full text-left px-4 py-3 text-label-md transition-colors ${
                      dateRange === key ? "text-electric-blue bg-electric-blue/10" : "text-on-surface-variant hover:bg-white/5"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowWidgetModal(true)}
            className="glass-btn p-2 rounded-lg text-on-surface hover:text-electric-blue transition-colors"
            title="Manage Widgets"
          >
            <span className="material-symbols-outlined text-[20px]">dashboard_customize</span>
          </button>
        </div>
      </header>

      {/* DACIS Alert */}
      {isFlagged && (
        <div className="mb-8 p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-4">
          <span className="material-symbols-outlined text-red-500 mt-0.5">warning</span>
          <div>
            <h3 className="text-label-lg text-red-500 font-semibold">Account Under Review</h3>
            <p className="text-body-md text-red-400/90 mt-1">
              Your account has been flagged by the DACIS engine due to suspicious activity. Transfers are temporarily restricted.
            </p>
            {flagReason && <p className="text-label-sm text-red-500/70 mt-2 font-mono">Reason: {flagReason}</p>}
          </div>
        </div>
      )}

      {/* Widget Management Modal */}
      {showWidgetModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 relative">
            <button onClick={() => setShowWidgetModal(false)} className="absolute top-4 right-4 text-on-surface-variant hover:text-white transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-electric-blue text-2xl">widgets</span>
              <h2 className="text-headline-sm text-pure-white">Manage Widgets</h2>
            </div>
            
            <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scroll pr-2">
              {[
                { key: "aiInsight", label: "Neuro AI Insight", icon: "auto_awesome" },
                { key: "balanceOverview", label: "Balance Overview", icon: "account_balance_wallet" },
                { key: "monthlyGoal", label: "Monthly Goal", icon: "track_changes" },
                { key: "spending", label: "Spending Analysis", icon: "bar_chart" },
                { key: "recentTxns", label: "Recent Transactions", icon: "receipt_long" },
                { key: "passbook", label: "Account Details (Passbook)", icon: "account_box" },
                { key: "quickTransfer", label: "Quick Transfer", icon: "swap_horiz" },
              ].map((w) => (
                <div key={w.key} className="flex items-center justify-between p-3 rounded-xl bg-surface-container/30 border border-outline-variant/30 hover:bg-surface-variant/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-electric-blue opacity-80">{w.icon}</span>
                    <span className="text-label-md text-pure-white">{w.label}</span>
                  </div>
                  <button
                    onClick={() => toggleWidget(w.key)}
                    className={`w-12 h-6 rounded-full relative transition-colors ${widgets[w.key] ? "bg-electric-blue" : "bg-surface-container-highest"}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${widgets[w.key] ? "left-7" : "left-1"}`}></div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-margin-desktop max-w-[1440px] mx-auto">
        {/* 1. AI Insights */}
        {widgets.aiInsight && (
        <div className="md:col-span-4 neuro-card p-6 mesh-gradient flex flex-col justify-between min-h-[240px]">
          <div>
            <div className="flex items-center gap-2 mb-4 text-primary">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
              <span className="text-label-md uppercase">Neuro AI Insight</span>
            </div>
            {topCategories.length > 0 ? (
              <>
                <h3 className="text-headline-md text-on-surface mb-2">Spending Analysis</h3>
                <p className="text-body-md text-on-surface-variant">
                  Your highest spending category is &apos;{topCategories[0][0]}&apos; at {formatINR(topCategories[0][1])}.
                  {topCategories.length > 1 && ` Followed by '${topCategories[1][0]}' at ${formatINR(topCategories[1][1])}.`}
                  {" "}We recommend reviewing recent spending patterns.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-headline-md text-on-surface mb-2">Getting started</h3>
                <p className="text-body-md text-on-surface-variant">Start making transactions to see AI-powered spending insights here.</p>
              </>
            )}
          </div>
          <button onClick={() => router.push("/transactions")} className="mt-4 text-electric-blue text-label-sm flex items-center gap-1 hover:text-primary transition-colors">
            Review Details <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        </div>
        )}

        {/* 2. Balance Overview */}
        {widgets.balanceOverview && (
        <div className="md:col-span-8 neuro-card-premium p-6 relative overflow-hidden flex flex-col justify-between min-h-[240px]">
          <div className="flex justify-between items-start mb-6 relative z-10">
            <div>
              <span className="text-label-md text-on-surface-variant uppercase">Total Balance</span>
              <h2 className="text-headline-xl text-on-surface glow-text mt-1">{formatINR(totalBalance)}</h2>
              
              {/* Account Details */}
              <div className="flex flex-wrap gap-6 mt-6">
                {accounts.slice(0, 3).map(acc => (
                  <div key={acc.id} className="flex flex-col border-l-2 border-electric-blue/50 pl-3">
                    <span className="text-body-md text-pure-white">{acc.name}</span>
                    <span className="text-[11px] text-on-surface-variant font-mono mt-1 tracking-wider">{acc.number} <span className="text-electric-blue ml-1">{formatINR(acc.balance)}</span></span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-surface-container/50 px-3 py-1 rounded-full border border-electric-blue/30 flex items-center gap-1">
              <span className={`material-symbols-outlined text-[16px] ${isPositive ? "text-electric-blue" : "text-error"}`}>{isPositive ? "trending_up" : "trending_down"}</span>
              <span className={`text-label-sm ${isPositive ? "text-electric-blue" : "text-error"}`}>{isPositive ? "+" : ""}{changePct}%</span>
            </div>
          </div>
          {/* Chart */}
          <div className="dashboard-chart-shell relative w-full h-[100px] mt-auto">
            <svg className="w-full h-full drop-shadow-[0_0_8px_rgba(255,107,0,0.5)]" preserveAspectRatio="none" viewBox="0 0 100 30">
              <defs>
                <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#FF6B00"></stop>
                  <stop offset="100%" stopColor="transparent"></stop>
                </linearGradient>
              </defs>
              <path d={chart.area} fill="url(#grad)" opacity="0.2"></path>
              <path d={chart.line} fill="none" stroke="#FF6B00" strokeWidth="0.5"></path>
              <path
                d={chart.line}
                fill="none"
                stroke="transparent"
                strokeWidth="10"
                className="cursor-crosshair"
                onMouseMove={handleChartMove}
                onMouseEnter={handleChartMove}
                onMouseLeave={() => setActiveChartPoint(null)}
              />
              {chart.points.map((point) => (
                <circle
                  key={`${point.day}-${point.value}`}
                  cx={point.x.toFixed(1)}
                  cy={point.y.toFixed(1)}
                  r="2.8"
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth="0"
                  className="cursor-pointer"
                  onMouseEnter={() => setActiveChartPoint(point)}
                  onMouseMove={handleChartMove}
                  onMouseLeave={() => setActiveChartPoint(null)}
                />
              ))}
            </svg>
            {activeChartPoint && (
              <div
                className="pointer-events-none absolute rounded-lg border border-electric-blue/20 bg-void-black/80 px-3 py-2 backdrop-blur-xl shadow-xl"
                style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px`, transform: "translate(-50%, -100%)" }}
              >
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">{activeChartPoint.label}</p>
                <p className="text-label-sm font-mono text-error">
                  {formatINR(activeChartPoint.value)} expenses
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between items-end px-2 pb-1 text-[10px] text-on-surface-variant text-label-sm opacity-50">
              {Array.from({ length: 4 }).map((_, index) => {
                const tickIndex = Math.round((chartRangeDays - 1) * (index / 3));
                const tickDate = new Date(chartStartDate);
                tickDate.setDate(chartStartDate.getDate() + tickIndex);
                return <span key={`${dateRange}-${tickIndex}`}>{tickDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>;
              })}
            </div>
          </div>
        </div>
        )}

        {/* 3. Monthly Goal */}
        {widgets.monthlyGoal && (
        <div className="md:col-span-4 neuro-card p-6 flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-full flex justify-between items-center mb-6">
            <span className="text-label-md text-on-surface-variant uppercase">Monthly Goal</span>
            <button onClick={() => {
              const nextGoal = window.prompt("Set your monthly savings goal in INR", String(goalTarget));
              if (nextGoal !== null) updateGoalTarget(nextGoal);
            }} className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
          </div>
          <div className="relative w-40 h-40 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" fill="transparent" r="40" stroke="#282935" strokeWidth="8"></circle>
              <circle className="drop-shadow-[0_0_5px_rgba(255,107,0,0.5)]" cx="50" cy="50" fill="transparent" r="40" stroke="#FF6B00" strokeDasharray="251.2" strokeDashoffset={strokeDashoffset} strokeWidth="8" strokeLinecap="round"></circle>
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-headline-lg text-on-surface">{goalPct}%</span>
              <span className="text-label-sm text-on-surface-variant">Reached</span>
            </div>
          </div>
          <div className="w-full flex justify-between mt-6 text-label-sm">
            <div className="flex flex-col">
              <span className="text-on-surface-variant">Target</span>
              <span className="text-on-surface">{formatINR(goalTarget)}</span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-on-surface-variant">Saved</span>
              <span className="text-electric-blue">{formatINR(Math.max(0, monthlySaved), { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>
        )}

        {/* 4. Spending Analysis */}
        {widgets.spending && (
        <div className="md:col-span-4 neuro-card p-6 flex flex-col min-h-[300px]">
          <div className="flex justify-between items-center mb-6">
            <span className="text-label-md text-on-surface-variant uppercase">Spending</span>
            <button onClick={() => router.push("/transactions")} className="text-label-sm text-primary flex items-center">
              Details <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            </button>
          </div>
          <div className="flex-1 flex items-end justify-between gap-2 px-2 pb-2">
            {topCategories.length > 0 ? topCategories.map(([cat, val], i) => {
              const heightPct = (val / maxSpending) * 85 + 15;
              const isMax = val === maxSpending;
              return (
                <div key={cat} className={`w-8 rounded-t-sm relative group ${
                  isMax ? "bg-electric-blue/80 shadow-[0_0_10px_rgba(255,107,0,0.3)] border-t border-electric-blue"
                  : i % 2 === 0 ? "bg-surface-container-high"
                  : "bg-tertiary-container/80 border-t border-tertiary"
                }`} style={{ height: `${heightPct}%` }}>
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 text-[10px] text-on-surface bg-void-black px-1 rounded transition-opacity whitespace-nowrap">{formatINR(val, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                </div>
              );
            }) : (
              <div className="flex-1 flex items-center justify-center text-label-sm text-on-surface-variant">No spending data</div>
            )}
          </div>
          {topCategories.length > 0 && (
            <div className="flex justify-between px-2 pt-2 border-t border-outline-variant/30 text-[10px] text-label-sm text-on-surface-variant">
              {topCategories.map(([cat], i) => (
                <span key={cat} className={i === 0 ? "text-electric-blue font-bold" : ""}>{cat.length > 8 ? cat.slice(0, 7) + "…" : cat}</span>
              ))}
            </div>
          )}
        </div>
        )}

        {/* 5. Recent Transactions */}
        {widgets.recentTxns && (
        <div className="md:col-span-4 neuro-card p-0 flex flex-col min-h-[300px] overflow-hidden">
          <div className="p-6 pb-4 border-b border-outline-variant/30 flex justify-between items-center bg-surface-container/30">
            <span className="text-label-md text-on-surface-variant uppercase">Recent Txns</span>
            <button onClick={() => router.push("/transactions")} className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-[18px]">search</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scroll p-2">
            {recentTxns.length > 0 ? recentTxns.map((txn, i) => (
              <div key={txn.id || i} className="flex items-center justify-between p-3 hover:bg-surface-variant/30 rounded-lg transition-colors cursor-pointer group" onClick={() => router.push("/transactions")}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center border border-outline-variant/50 group-hover:border-electric-blue/50 transition-colors">
                    <span className={`material-symbols-outlined text-[20px] ${txn.amount > 0 ? "text-electric-blue" : "text-on-surface"}`}>{txn.icon || "receipt"}</span>
                  </div>
                  <div>
                    <p className="text-label-md text-on-surface">{txn.name}</p>
                    <p className="text-[10px] text-label-sm text-on-surface-variant">{txn.category} · {txn.card}</p>
                  </div>
                </div>
                <span className={`text-label-md ${txn.amount > 0 ? "text-electric-blue glow-text" : "text-on-surface"}`}>
                  {txn.amount > 0 ? "+" : ""}{formatINR(Math.abs(txn.amount))}
                </span>
              </div>
            )) : (
              <div className="flex items-center justify-center h-full text-label-sm text-on-surface-variant">No transactions yet</div>
            )}
          </div>
        </div>
        )}

        {/* 6. Account Details / Passbook (New Widget) */}
        {widgets.passbook && (
        <div className="md:col-span-8 neuro-card p-6 flex flex-col min-h-[300px] relative overflow-hidden bg-gradient-to-br from-surface to-surface-container-lowest border border-electric-blue/20">
          {/* Holographic Watermark */}
          <div className="absolute right-[-20%] bottom-[-20%] opacity-[0.03] pointer-events-none transform rotate-[-15deg]">
             <span className="material-symbols-outlined" style={{ fontSize: '300px' }}>account_balance</span>
          </div>
          
          <div className="flex justify-between items-center mb-6 border-b border-outline-variant/30 pb-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-electric-blue text-2xl">account_box</span>
              <span className="text-label-md text-on-surface-variant uppercase tracking-widest">Bank Passbook</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => {
                const rows = [
                  ["Date", "Name", "Category", "Card", "Amount (INR)"],
                  ...currentMonthTransactions.map((txn) => [
                    txn.createdAt?.slice(0, 10) || "",
                    txn.name || "",
                    txn.category || "",
                    txn.card || "",
                    Number(txn.amount || 0).toFixed(2),
                  ]),
                ];
                const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `neurobank_statement_${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(url);
                toast.success(`Statement exported for ${currentMonthLabel}`);
              }} className="text-electric-blue hover:text-primary transition-colors" title="Download Statement">
                <span className="material-symbols-outlined text-[20px]">download</span>
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scroll pr-2">
            {accounts.length > 0 ? accounts.map((acc, idx) => (
              <div key={acc.id} className={`flex flex-col md:flex-row gap-6 p-4 rounded-xl ${idx % 2 === 0 ? 'bg-surface-container/20' : 'bg-transparent'} border border-transparent hover:border-electric-blue/10 transition-colors mb-2`}>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-headline-sm text-pure-white">{acc.name}</h3>
                    <span className="text-label-sm px-2 py-1 bg-primary-container/20 text-primary rounded uppercase tracking-wider text-[10px]">{acc.type}</span>
                  </div>
                  <p className="text-headline-md text-electric-blue glow-text mb-4">{formatINR(acc.balance)}</p>
                  
                  <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                    <div>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">Account Number</p>
                      <p className="text-body-md text-pure-white font-mono bg-black/20 px-2 py-1 rounded select-all inline-block border border-white/5">{acc.number.replace('****', '4901 0293 ')}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">IFSC Code</p>
                      <p className="text-body-md text-pure-white font-mono bg-black/20 px-2 py-1 rounded select-all inline-block border border-white/5">NROB0001024</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">SWIFT / BIC</p>
                      <p className="text-body-md text-pure-white font-mono">NROBUS31</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">Routing Number</p>
                      <p className="text-body-md text-pure-white font-mono">021000021</p>
                    </div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="flex items-center justify-center h-full text-label-sm text-on-surface-variant">No active accounts</div>
            )}
          </div>
        </div>
        )}

        {/* 7. Quick Transfer (New Widget) */}
        {widgets.quickTransfer && (
        <div className="md:col-span-4 neuro-card p-6 flex flex-col min-h-[300px] border border-electric-blue/10 bg-gradient-to-br from-surface to-surface-container">
          <div className="flex justify-between items-center mb-6">
            <span className="text-label-md text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
              <span className="material-symbols-outlined text-electric-blue">swap_horiz</span>
              Quick Transfer
            </span>
          </div>
          
          <div className="flex-1 flex flex-col justify-center">
            <div className="mb-4">
              <label className="text-[10px] text-on-surface-variant uppercase tracking-widest block mb-2">Send To</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">person</span>
                <input type="text" placeholder="Name, Email, or Node ID" className="w-full bg-surface-container-highest border border-outline-variant/30 rounded-lg py-3 pl-10 pr-4 text-body-md text-pure-white focus:border-electric-blue transition-colors focus:outline-none" />
              </div>
            </div>
            
            <div className="mb-6">
              <label className="text-[10px] text-on-surface-variant uppercase tracking-widest block mb-2">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold">₹</span>
                <input type="number" placeholder="0.00" className="w-full bg-surface-container-highest border border-outline-variant/30 rounded-lg py-3 pl-8 pr-4 text-body-md text-pure-white focus:border-electric-blue transition-colors focus:outline-none font-mono" />
              </div>
            </div>
            
            <button onClick={() => router.push("/transfers")} className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md uppercase tracking-widest font-bold hover:bg-primary-container transition-colors shadow-[0_0_15px_rgba(255,107,0,0.3)] hover:shadow-[0_0_20px_rgba(255,107,0,0.5)]">
              Send Funds
            </button>
          </div>
        </div>
        )}

      </div>
    </>
  );
}

