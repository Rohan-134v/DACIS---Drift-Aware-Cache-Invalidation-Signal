"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { formatINR } from "@/lib/money";
import { fetchJsonWithRetry } from "@/lib/fetch-json";

export default function InvestmentsPage() {
  const [user, setUser]               = useState(null);
  const [holdings, setHoldings]       = useState({ Stocks: [], ETFs: [], Bonds: [] });
  const [filter, setFilter]           = useState("Stocks");
  const [loading, setLoading]         = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [orderError, setOrderError]   = useState("");
  const [ordering, setOrdering]       = useState(false);
  const [timePeriod, setTimePeriod]   = useState("1Y");
  const [activePoint, setActivePoint] = useState(null);
  const [tooltipPos, setTooltipPos]   = useState({ x: 12, y: 12 });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  const getToken = () => user?.getIdToken();

  const fetchInvestments = async () => {
    if (!user) return;
    try {
      const t = await getToken();
      const res = await fetchJsonWithRetry("/api/investments", { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) return;
      const data = res.data;
      const grouped = { Stocks: [], ETFs: [], Bonds: [] };
      data.forEach((inv) => {
        const cat = grouped[inv.category] ? inv.category : "Stocks";
        grouped[cat].push(inv);
      });
      setHoldings(grouped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchInvestments();
    const interval = setInterval(fetchInvestments, 15000);
    const handleFocus = () => fetchInvestments();
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [user]);

  const handleOrder = async (e) => {
    e.preventDefault();
    setOrderError("");
    setOrdering(true);
    const symbol   = e.target.symbol.value.trim().toUpperCase();
    const type     = e.target.type.value;
    const amount   = e.target.amount.value;
    const category = e.target.category.value;

    try {
      const t = await getToken();
      const res = await fetch("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ symbol, type, amount, category }),
      });
      const data = await res.json();
      if (!res.ok) { setOrderError(data.message); return; }
      setIsModalOpen(false);
      fetchInvestments();
    } catch {
      setOrderError("Order failed. Please try again.");
    } finally {
      setOrdering(false);
    }
  };

  const allHoldings = [...holdings.Stocks, ...holdings.ETFs, ...holdings.Bonds];
  const totalValue  = allHoldings.reduce((s, h) => s + parseFloat(h.value || 0), 0);
  const totalCost   = allHoldings.reduce((s, h) => s + parseFloat(h.shares || 0) * parseFloat(h.avgPrice || 0), 0);
  const totalPL     = totalValue - totalCost;
  const totalPLPct  = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  const isGain = totalPL >= 0;

  const currentHoldings = holdings[filter] || [];

  const chartPoints = allHoldings.length > 0
    ? allHoldings.map((holding, index) => {
        const value = parseFloat(holding.value || 0);
        const x = allHoldings.length === 1 ? 0 : (index / (allHoldings.length - 1)) * 200;
        return {
          x,
          value,
          label: holding.symbol,
          displayValue: formatINR(value),
          positive: parseFloat(holding.plAbs || 0) >= 0,
          plAbs: parseFloat(holding.plAbs || 0),
          plPct: parseFloat(holding.plPct || 0),
        };
      })
    : [];

  const chartMax = chartPoints.length > 0 ? Math.max(...chartPoints.map((p) => p.value)) : 1;
  const chartMin = chartPoints.length > 0 ? Math.min(...chartPoints.map((p) => p.value)) : 0;
  const chartRange = chartMax - chartMin || 1;
  const normalizedChart = chartPoints.map((point, index) => ({
    ...point,
    y: 52 - ((point.value - chartMin) / chartRange) * 34,
    index,
  }));
  const chartPath = normalizedChart.length > 0
    ? normalizedChart.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")
    : "M0 52 L200 52";
  const chartArea = normalizedChart.length > 0
    ? `${chartPath} L200 60 L0 60 Z`
    : "M0 52 L200 52 L200 60 L0 60 Z";

  const handleChartMove = (event) => {
    if (normalizedChart.length === 0) return;
    const rect = event.currentTarget.closest(".investment-chart-shell")?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const clampedX = Math.max(0, Math.min(200, xRatio * 200));
    const nearest = normalizedChart.reduce((best, point) => {
      if (!best) return point;
      return Math.abs(point.x - clampedX) < Math.abs(best.x - clampedX) ? point : best;
    }, null);
    setActivePoint(nearest);
    setTooltipPos({
      x: Math.max(12, Math.min(rect.width - 24, event.clientX - rect.left)),
      y: Math.max(8, (event.clientY - rect.top) - 12),
    });
  };

  const assets = [
    { name: "Equities", pct: 45, color: "bg-electric-blue" },
    { name: "Bonds",    pct: 25, color: "bg-primary" },
    { name: "Crypto",   pct: 15, color: "bg-tertiary" },
    { name: "Real Estate", pct: 10, color: "bg-secondary" },
    { name: "Cash",     pct: 5,  color: "bg-starlight-gray" },
  ];

  return (
    <>
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-headline-lg-mobile md:text-headline-xl text-pure-white mb-2">Investments & Wealth</h1>
          <p className="text-body-md text-on-surface-variant">Live market prices via Finnhub. Manage your portfolio across all asset classes.</p>
        </div>
        <button
          onClick={() => { setIsModalOpen(true); setOrderError(""); }}
          className="flex items-center justify-center gap-2 bg-electric-blue text-pure-white px-6 py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors shadow-[0_0_15px_rgba(13,23,231,0.3)]"
        >
          <span className="material-symbols-outlined">rocket_launch</span>
          New Investment
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
        {/* Portfolio Value */}
        <div className="md:col-span-8 neuro-card-premium p-6 md:p-8 relative overflow-hidden min-h-[300px]">
          <div className="flex justify-between items-start mb-6 relative z-10">
            <div>
              <span className="text-label-md text-on-surface-variant uppercase">Portfolio Value</span>
              <h2 className="text-headline-xl text-pure-white glow-text mt-1">
                {formatINR(totalValue)}
              </h2>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-label-sm px-2 py-1 rounded-full border flex items-center gap-1 ${isGain ? "text-electric-blue bg-electric-blue/10 border-electric-blue/20" : "text-error bg-error/10 border-error/20"}`}>
                  <span className="material-symbols-outlined text-[14px]">{isGain ? "trending_up" : "trending_down"}</span>
                  {isGain ? "+" : ""}{formatINR(Math.abs(totalPL))} ({totalPLPct >= 0 ? "+" : ""}{totalPLPct.toFixed(2)}%)
                </span>
                <span className="text-label-sm text-on-surface-variant">All Time</span>
              </div>
            </div>
            <div className="flex gap-2">
              {["1W", "1M", "1Y", "All"].map((p) => (
                <button
                  key={p}
                  onClick={() => setTimePeriod(p)}
                  className={`text-label-sm px-3 py-1 rounded-lg transition-colors border ${
                    timePeriod === p
                      ? "text-electric-blue bg-electric-blue/10 border-electric-blue/30"
                      : "text-on-surface-variant hover:bg-surface-container border-outline-variant/30"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="investment-chart-shell w-full h-[140px] relative mt-4">
            <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 200 60">
              <defs>
                <linearGradient id="investGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#FF8A00" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#FF8A00" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={chartArea} fill="url(#investGrad)" />
              <path d={chartPath} fill="none" stroke="#FF8A00" strokeWidth="1.25" />
              <path
                d={chartPath}
                fill="none"
                stroke="transparent"
                strokeWidth="10"
                className="cursor-crosshair"
                onMouseMove={handleChartMove}
                onMouseEnter={handleChartMove}
                onMouseLeave={() => setActivePoint(null)}
              />
              {normalizedChart.map((point) => (
                <circle
                  key={point.label}
                  cx={point.x.toFixed(1)}
                  cy={point.y.toFixed(1)}
                  r="3"
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth="0"
                  className="cursor-pointer"
                  onMouseEnter={() => setActivePoint(point)}
                  onMouseLeave={() => setActivePoint(null)}
                />
              ))}
            </svg>
            {activePoint && (
                <div
                  className="pointer-events-none absolute rounded-lg border border-outline-variant/40 bg-void-black/85 px-3 py-2 backdrop-blur-xl shadow-xl"
                  style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px`, transform: "translate(-50%, -100%)" }}
                >
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">{activePoint.label}</p>
                  <p className={`text-label-sm font-mono ${activePoint.positive ? "text-green-400" : "text-error"}`}>
                    {activePoint.positive ? "+" : "-"}{formatINR(Math.abs(activePoint.plAbs || activePoint.value))} {activePoint.positive ? "profit" : "loss"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Asset Allocation */}
        <div className="md:col-span-4 neuro-card p-6 flex flex-col min-h-[300px]">
          <h3 className="text-label-md text-on-surface-variant uppercase mb-6">Asset Allocation</h3>
          <div className="flex-1 flex flex-col justify-center gap-4">
            {assets.map((asset, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${asset.color}`} />
                <span className="text-body-md text-on-surface flex-1">{asset.name}</span>
                <span className="text-label-md text-on-surface-variant">{asset.pct}%</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant/30">
            <div className="flex h-2 rounded-full overflow-hidden">
              {assets.map((asset, i) => (
                <div key={i} className={asset.color} style={{ width: `${asset.pct}%` }} />
              ))}
            </div>
          </div>
        </div>

        {/* Holdings Table */}
        <div className="md:col-span-12 glass-panel rounded-xl overflow-hidden">
          <div className="p-6 border-b border-outline-variant/30 flex justify-between items-center">
            <h3 className="text-headline-md text-pure-white">Holdings</h3>
            <div className="flex items-center gap-2">
              {["Stocks", "ETFs", "Bonds"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-label-sm px-3 py-1 rounded-lg transition-colors border ${
                    filter === f
                      ? "text-on-surface bg-surface-container border-outline-variant/30"
                      : "text-on-surface-variant hover:bg-surface-container border-outline-variant/30"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-10 text-center text-on-surface-variant text-label-md flex items-center justify-center gap-2">
                <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                Loading live prices…
              </div>
            ) : currentHoldings.length === 0 ? (
              <div className="p-10 text-center text-on-surface-variant text-label-md">No {filter} holdings yet.</div>
            ) : (
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-label-sm text-on-surface-variant border-b border-outline-variant/20">
                    <th className="text-left p-4">Asset</th>
                    <th className="text-left p-4">Shares</th>
                    <th className="text-left p-4">Avg. Price</th>
                    <th className="text-left p-4">Live Price</th>
                    <th className="text-left p-4">Value</th>
                    <th className="text-right p-4">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {currentHoldings.map((stock) => (
                    <tr key={stock.id} className="border-b border-outline-variant/10 hover:bg-surface-container-high/30 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-surface-container-high flex items-center justify-center text-label-sm text-primary border border-outline-variant/30 font-mono">
                            {stock.symbol.charAt(0)}
                          </div>
                          <div>
                            <p className="text-body-md text-pure-white font-medium">{stock.symbol}</p>
                            <p className="text-[11px] text-on-surface-variant truncate max-w-[160px]">{stock.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-label-md text-on-surface font-mono">{parseFloat(stock.shares).toFixed(4)}</td>
                      <td className="p-4 text-label-md text-on-surface-variant font-mono">{formatINR(parseFloat(stock.avgPrice))}</td>
                      <td className="p-4 text-label-md text-on-surface font-mono">{formatINR(parseFloat(stock.currentPrice))}</td>
                      <td className="p-4 text-label-md text-on-surface font-mono">{formatINR(parseFloat(stock.value))}</td>
                      <td className={`p-4 text-label-md text-right font-mono ${stock.positive ? "text-green-400" : "text-error"}`}>
                        {stock.positive ? "+" : "-"}{formatINR(Math.abs(stock.plAbs || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* New Investment Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-void-black/80 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-md rounded-2xl p-8 relative shadow-2xl border border-outline-variant/30">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-on-surface-variant hover:text-pure-white transition-colors"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <h2 className="text-headline-md text-pure-white mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined text-electric-blue">rocket_launch</span>
              New Investment
            </h2>
            <p className="text-body-md text-on-surface-variant mb-6">Live market price fetched from Finnhub on execution.</p>

            <form onSubmit={handleOrder} className="space-y-5">
              <div className="space-y-2">
                <label className="text-label-sm text-on-surface-variant uppercase">Ticker Symbol</label>
                <input
                  name="symbol"
                  type="text"
                  required
                  placeholder="e.g. AAPL, TSLA, NVDA"
                  className="w-full bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg px-4 py-3 text-pure-white text-body-md focus:outline-none focus:border-electric-blue transition-colors uppercase placeholder:normal-case"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-label-sm text-on-surface-variant uppercase">Order Type</label>
                  <select name="type" className="w-full bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg px-4 py-3 text-pure-white text-body-md focus:outline-none focus:border-electric-blue transition-colors">
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-label-sm text-on-surface-variant uppercase">Category</label>
                  <select name="category" className="w-full bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg px-4 py-3 text-pure-white text-body-md focus:outline-none focus:border-electric-blue transition-colors">
                    <option value="Stocks">Stocks</option>
                    <option value="ETFs">ETFs</option>
                    <option value="Bonds">Bonds</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-label-sm text-on-surface-variant uppercase">Amount (INR)</label>
                <input
                  name="amount"
                  type="number"
                  required
                  min="1"
                  step="0.01"
                  placeholder="1000"
                  className="w-full bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg px-4 py-3 text-pure-white text-body-md focus:outline-none focus:border-electric-blue transition-colors"
                />
              </div>

              {orderError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-label-sm">
                  <span className="material-symbols-outlined text-[16px] mt-0.5 shrink-0">error</span>
                  {orderError}
                </div>
              )}

              <button
                type="submit"
                disabled={ordering}
                className="w-full mt-2 bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors shadow-[0_0_15px_rgba(13,23,231,0.3)] flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {ordering ? (
                  <><span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>Fetching live price…</>
                ) : (
                  <><span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>Execute Trade</>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
