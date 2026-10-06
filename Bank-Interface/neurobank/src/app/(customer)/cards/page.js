"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/app/components/Toast";
import { formatINR } from "@/lib/money";

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="glass-panel rounded-xl p-6 w-full max-w-sm mx-4 border border-outline-variant">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-body-lg text-pure-white">{title}</h3>
        <button onClick={onClose} className="text-on-surface-variant hover:text-pure-white"><span className="material-symbols-outlined">close</span></button>
      </div>
      {children}
    </div>
  </div>
);

export default function CardsPage() {
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [cards, setCards] = useState([]);
  const [activeCard, setActiveCard] = useState(null);
  const [revealLoading, setRevealLoading] = useState(false);

  // Modals
  const [pinModal, setPinModal] = useState(false);
  const [pinForm, setPinForm] = useState({ newPin: "", currentPin: "" });
  const [pinLoading, setPinLoading] = useState(false);

  const [limitModal, setLimitModal] = useState(false);
  const [limitAmount, setLimitAmount] = useState("");
  const [limitLoading, setLimitLoading] = useState(false);

  const [autopays, setAutopays] = useState([]);
  const [autopayModal, setAutopayModal] = useState(false);
  const [autopayForm, setAutopayForm] = useState({ merchant: "", amount: "", cycle: "monthly" });
  const [autopayLoading, setAutopayLoading] = useState(false);

  const [issueModal, setIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState({ cardType: "virtual", name: "" });
  const [issueLoading, setIssueLoading] = useState(false);
  const [newCardDetails, setNewCardDetails] = useState(null);

  const [pinRevealInput, setPinRevealInput] = useState("");
  const [pinRevealModal, setPinRevealModal] = useState(false);

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
    fetch("/api/cards", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setCards(data);
          setActiveCard(data[0]);
        }
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token || !activeCard?.id) return;
    fetch(`/api/cards/${activeCard.id}/autopays`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setAutopays(data))
      .catch(() => {});
  }, [activeCard?.id, token]);

  const card = activeCard || {};
  const cardFrozen = card.frozen || false;
  const cardLimits = card.limits || { online: true, international: false, atm: true };

  const api = (path, opts = {}) =>
    fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });

  const handleFreeze = async () => {
    if (!card.id) return;
    try {
      const res = await api(`/api/cards/${card.id}/freeze`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const updated = { ...card, frozen: data.frozen };
      setActiveCard(updated);
      setCards((prev) => prev.map((c) => c.id === card.id ? updated : c));
      toast.success(data.frozen ? "Card frozen" : "Card unfrozen");
    } catch (err) { toast.error(err.message || "Failed"); }
  };

  const handlePermission = async (perm, current) => {
    if (!card.id) return;
    try {
      const res = await api(`/api/cards/${card.id}/limits`, { method: "PATCH", body: JSON.stringify({ [perm]: !current }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const newLimits = { ...cardLimits, [perm]: !current };
      const updated = { ...card, limits: newLimits };
      setActiveCard(updated);
      setCards((prev) => prev.map((c) => c.id === card.id ? updated : c));
      toast.success(`${perm} ${!current ? "enabled" : "disabled"}`);
    } catch (err) { toast.error(err.message || "Failed"); }
  };

  const handleReveal = async (pin) => {
    if (!card.id) return;
    setRevealLoading(true);
    try {
      const url = pin ? `/api/cards/${card.id}/reveal?pin=${pin}` : `/api/cards/${card.id}/reveal`;
      const res = await api(url);
      const data = await res.json();
      if (res.status === 403 && data.requiresPin) {
        setPinRevealModal(true);
        setRevealLoading(false);
        return;
      }
      if (!res.ok) throw new Error(data.message);
      setActiveCard((prev) => ({ ...prev, fullNumber: data.fullNumber, cvv: data.cvv }));
      setPinRevealModal(false);
      setPinRevealInput("");
    } catch (err) { toast.error(err.message || "Failed to reveal"); }
    setRevealLoading(false);
  };

  const handleCopy = () => {
    const num = card.fullNumber || card.number || "";
    navigator.clipboard.writeText(num).then(() => toast.success("Copied")).catch(() => toast.error("Failed to copy"));
  };

  const handlePin = async () => {
    setPinLoading(true);
    try {
      const res = await api(`/api/cards/${card.id}/pin`, { method: "PATCH", body: JSON.stringify(pinForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast.success("PIN updated");
      setPinModal(false);
      setPinForm({ newPin: "", currentPin: "" });
      const updated = { ...card, hasPin: true };
      setActiveCard(updated);
      setCards((prev) => prev.map((c) => c.id === card.id ? updated : c));
    } catch (err) { toast.error(err.message || "Failed"); }
    setPinLoading(false);
  };

  const handleSpendingLimit = async () => {
    setLimitLoading(true);
    try {
      const amount = limitAmount === "" ? null : parseFloat(limitAmount);
      const res = await api(`/api/cards/${card.id}/spending-limit`, { method: "PATCH", body: JSON.stringify({ amount }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast.success(data.message);
      setLimitModal(false);
      setLimitAmount("");
      const updated = { ...card, spendingLimit: data.spendingLimit };
      setActiveCard(updated);
      setCards((prev) => prev.map((c) => c.id === card.id ? updated : c));
    } catch (err) { toast.error(err.message || "Failed"); }
    setLimitLoading(false);
  };

  const handleAddAutopay = async () => {
    setAutopayLoading(true);
    try {
      const res = await api(`/api/cards/${card.id}/autopays`, { method: "POST", body: JSON.stringify(autopayForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setAutopays((prev) => [...prev, data]);
      setAutopayModal(false);
      setAutopayForm({ merchant: "", amount: "", cycle: "monthly" });
      toast.success("Autopay added");
    } catch (err) { toast.error(err.message || "Failed"); }
    setAutopayLoading(false);
  };

  const handleDeleteAutopay = async (apId) => {
    try {
      const res = await api(`/api/cards/${card.id}/autopays/${apId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setAutopays((prev) => prev.filter((a) => a.id !== apId));
      toast.success("Autopay removed");
    } catch (err) { toast.error(err.message || "Failed"); }
  };

  const handleToggleAutopay = async (apId) => {
    try {
      const res = await api(`/api/cards/${card.id}/autopays/${apId}/toggle`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setAutopays((prev) => prev.map((a) => a.id === apId ? data.autopay : a));
    } catch (err) { toast.error(err.message || "Failed"); }
  };

  const handleDeleteCard = async () => {
    if (!card.id) return;
    try {
      const res = await api(`/api/cards/${card.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const remaining = cards.filter((c) => c.id !== card.id);
      setCards(remaining);
      setActiveCard(remaining[0] || null);
      toast.success("Card deleted");
    } catch (err) { toast.error(err.message || "Failed"); }
  };

  const handleIssueCard = async () => {
    setIssueLoading(true);
    try {
      const res = await api("/api/cards", { method: "POST", body: JSON.stringify(issueForm) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      const { fullNumber, cvv, ...cardSafe } = data;
      const newCard = { ...cardSafe, hasPin: false, fullNumber, cvv };
      setCards((prev) => [...prev, { ...cardSafe, hasPin: false }]);
      setActiveCard(newCard);
      setIssueModal(false);
      setIssueForm({ cardType: "virtual", name: "" });
      setNewCardDetails({ fullNumber, cvv, expiry: data.expiry });
    } catch (err) { toast.error(err.message || "Failed"); }
    setIssueLoading(false);
  };

  const permissions = [
    { key: "online", icon: "language", name: "Online Orders", desc: "Allow transactions on e-commerce platforms.", limit: formatINR(5000) + " / day", enabled: cardLimits.online },
    { key: "international", icon: "flight_takeoff", name: "International", desc: "Enable purchases outside your home region.", limit: "--", enabled: cardLimits.international },
    { key: "atm", icon: "local_atm", name: "ATM Access", desc: "Permit cash withdrawals at ATMs globally.", limit: formatINR(1000) + " / day", enabled: cardLimits.atm },
  ];

  return (
    <>
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-headline-lg-mobile md:text-headline-xl text-pure-white mb-2">Card Management</h1>
          <p className="text-body-md text-on-surface-variant">Control your physical and virtual financial interfaces.</p>
        </div>
        <button
          onClick={() => setIssueModal(true)}
          className="flex items-center justify-center gap-2 bg-electric-blue text-pure-white px-6 py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors shadow-[0_0_15px_rgba(255,107,0,0.3)]"
        >
          <span className="material-symbols-outlined">add_card</span>
          Get Card
        </button>
      </header>

      {/* Card Selector */}
      {cards.length > 1 && (
        <div className="flex gap-3 mb-6 overflow-x-auto pb-2">
          {cards.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCard({ ...c, fullNumber: undefined, cvv: undefined })}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-label-md border transition-colors ${activeCard?.id === c.id ? "bg-electric-blue border-electric-blue text-pure-white" : "bg-surface-container-low border-outline-variant text-on-surface-variant hover:border-primary/50"}`}
            >
              {c.name} ···· {c.last4}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
        {/* Card Visualization */}
        <div className="md:col-span-8 glass-panel rounded-xl p-6 md:p-8 flex flex-col justify-between min-h-[400px] relative overflow-hidden group">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-primary/20 blur-[100px] rounded-full pointer-events-none opacity-50 group-hover:opacity-80 transition-opacity duration-500"></div>
          <div className="flex justify-between items-start relative z-10">
            <h2 className="text-headline-md text-primary-fixed">{card.name || "Neuro Card"}</h2>
            <span className={`px-3 py-1 rounded-full border text-label-sm flex items-center gap-2 backdrop-blur-md ${cardFrozen ? "bg-error/10 border-error/30 text-error" : "bg-primary/10 border-primary/30 text-primary"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cardFrozen ? "bg-error" : "bg-primary animate-pulse"}`}></span>
              {cardFrozen ? "Frozen" : `${card.cardType === "virtual" ? "Virtual" : "Physical"} Active`}
            </span>
          </div>

          <div className="relative w-full max-w-md mx-auto aspect-[1.586/1] mt-8 mb-8">
            <div className={`w-full h-full relative rounded-xl shadow-2xl glass-panel border border-white/20 overflow-hidden cursor-pointer transition-transform duration-700 hover:scale-105 ${cardFrozen ? "opacity-60 grayscale" : ""}`}>
              <div className="absolute inset-0 hologram-effect opacity-50 mix-blend-screen pointer-events-none"></div>
              <div className="absolute inset-0 p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <span className="material-symbols-outlined text-[40px] text-pure-white/80">contactless</span>
                  <div className="text-right">
                    <div className="text-label-sm text-pure-white/60 uppercase tracking-widest">DACIS Select</div>
                    {card.cvv && <div className="text-label-sm text-pure-white/80 font-mono mt-1">CVV: {card.cvv}</div>}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="text-headline-md text-pure-white font-mono tracking-widest">
                    {card.fullNumber
                      ? card.fullNumber.replace(/(\d{4})/g, "$1 ").trim()
                      : card.number || "•••• •••• •••• ####"}
                  </div>
                  <div className="flex justify-between items-end">
                    <div>
                      <div className="text-[10px] text-pure-white/60 uppercase tracking-wider mb-1">Cardholder</div>
                      <div className="text-body-md text-pure-white tracking-wide">{card.holder || "---"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-pure-white/60 uppercase tracking-wider mb-1">Valid Thru</div>
                      <div className="text-body-md text-pure-white font-mono">{card.expiry || "--/--"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-4 relative z-10">
            <button
              onClick={() => card.fullNumber ? setActiveCard((prev) => { const { fullNumber, cvv, ...rest } = prev; return rest; }) : handleReveal()}
              disabled={revealLoading}
              className="bg-surface-variant/50 hover:bg-surface-variant text-on-surface px-4 py-2 rounded-lg text-label-md border border-outline-variant transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">{card.fullNumber ? "visibility_off" : "visibility"}</span>
              {revealLoading ? "Loading..." : card.fullNumber ? "Hide Details" : "Reveal Details"}
            </button>
            <button onClick={handleCopy} className="bg-surface-variant/50 hover:bg-surface-variant text-on-surface px-4 py-2 rounded-lg text-label-md border border-outline-variant transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">content_copy</span> Copy Number
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="md:col-span-4 flex flex-col gap-gutter">
          {/* Freeze */}
          <div className="glass-panel rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-4 ${cardFrozen ? "bg-electric-blue/10 border border-electric-blue/30 text-electric-blue" : "bg-error-container/20 border border-error-container/50 text-error"}`}>
                <span className="material-symbols-outlined">{cardFrozen ? "lock_open" : "ac_unit"}</span>
              </div>
              <h3 className="text-body-lg text-pure-white mb-2">{cardFrozen ? "Unfreeze Card" : "Freeze Card"}</h3>
              <p className="text-label-md text-on-surface-variant mb-6 leading-relaxed">
                {cardFrozen ? "Unfreeze to re-enable all purchases and ATM withdrawals." : "Instantly block all new purchases and ATM withdrawals."}
              </p>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-surface-container-low border border-outline-variant">
              <span className="text-body-md text-on-surface">Status: {cardFrozen ? "Frozen" : "Active"}</span>
              <button onClick={handleFreeze} className="relative inline-block w-12 h-6 cursor-pointer">
                <div className={`w-full h-full rounded-full transition-colors ${cardFrozen ? "bg-electric-blue" : "bg-surface-variant"}`}></div>
                <div className={`absolute top-0 w-6 h-6 rounded-full bg-white border-4 border-surface-container-low transition-all ${cardFrozen ? "right-0" : "left-0"}`}></div>
              </button>
            </div>
            <button onClick={handleDeleteCard}
              className="mt-3 w-full flex items-center justify-center gap-2 text-error border border-error/30 bg-error/5 hover:bg-error/10 rounded-lg py-2 text-label-md transition-colors">
              <span className="material-symbols-outlined text-[18px]">delete</span> Delete Card
            </button>
          </div>

          {/* PIN */}
          <div onClick={() => setPinModal(true)} className="glass-panel rounded-xl p-6 hover:border-primary/30 transition-all cursor-pointer flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-surface-variant border border-outline-variant flex items-center justify-center text-primary group-hover:text-primary-fixed transition-colors">
                <span className="material-symbols-outlined">pin</span>
              </div>
              <div>
                <h3 className="text-body-md text-pure-white">{card.hasPin ? "Change PIN" : "Set PIN"}</h3>
                <p className="text-label-sm text-on-surface-variant mt-1">{card.hasPin ? "Update your 4-digit code" : "Set a 4-digit security code"}</p>
              </div>
            </div>
            <span className="material-symbols-outlined text-on-surface-variant group-hover:text-pure-white transition-colors">chevron_right</span>
          </div>

          {/* Spending Limit */}
          <div onClick={() => { setLimitAmount(card.spendingLimit ?? ""); setLimitModal(true); }} className="glass-panel rounded-xl p-6 hover:border-primary/30 transition-all cursor-pointer flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-surface-variant border border-outline-variant flex items-center justify-center text-primary group-hover:text-primary-fixed transition-colors">
                <span className="material-symbols-outlined">price_check</span>
              </div>
              <div>
                <h3 className="text-body-md text-pure-white">Spending Limit</h3>
                <p className="text-label-sm text-on-surface-variant mt-1">{card.spendingLimit ? `${formatINR(card.spendingLimit)} / day` : "No limit set"}</p>
              </div>
            </div>
            <span className="material-symbols-outlined text-on-surface-variant group-hover:text-pure-white transition-colors">chevron_right</span>
          </div>
        </div>

        {/* Transaction Permissions */}
        <div className="md:col-span-12 glass-panel rounded-xl p-6 md:p-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="material-symbols-outlined text-primary">admin_panel_settings</span>
            <h2 className="text-headline-md text-pure-white">Transaction Permissions</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {permissions.map((perm) => (
              <div key={perm.key} className="bg-surface-container-low border border-outline-variant rounded-lg p-5 flex flex-col justify-between">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded bg-surface-variant text-on-surface"><span className="material-symbols-outlined">{perm.icon}</span></div>
                    <span className="text-body-md text-pure-white">{perm.name}</span>
                  </div>
                  <button onClick={() => handlePermission(perm.key, perm.enabled)} className="relative inline-block w-10 h-5 cursor-pointer">
                    <div className={`w-full h-full rounded-full transition-colors ${perm.enabled ? "bg-electric-blue" : "bg-surface-variant"}`}></div>
                    <div className={`absolute top-0 w-5 h-5 rounded-full bg-white border-4 border-surface-container-low transition-all ${perm.enabled ? "right-0" : "left-0"}`}></div>
                  </button>
                </div>
                <p className="text-label-sm text-on-surface-variant">{perm.desc}</p>
                <div className={`mt-4 pt-4 border-t border-outline-variant flex justify-between items-center text-label-sm ${!perm.enabled ? "opacity-50" : ""}`}>
                  <span className="text-on-surface-variant">Limit</span>
                  <span className="text-primary font-mono">{perm.limit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Autopays */}
        <div className="md:col-span-12 glass-panel rounded-xl p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">autorenew</span>
              <h2 className="text-headline-md text-pure-white">Autopays</h2>
            </div>
            <button onClick={() => setAutopayModal(true)} className="flex items-center gap-2 bg-surface-variant hover:bg-surface-container-high text-on-surface px-4 py-2 rounded-lg text-label-md border border-outline-variant transition-colors">
              <span className="material-symbols-outlined text-[18px]">add</span> Add
            </button>
          </div>
          {autopays.length === 0 ? (
            <p className="text-on-surface-variant text-label-md text-center py-6">No autopays set up for this card.</p>
          ) : (
            <div className="space-y-3">
              {autopays.map((ap) => (
                <div key={ap.id} className="flex items-center justify-between bg-surface-container-low border border-outline-variant rounded-lg px-5 py-4">
                  <div>
                    <div className="text-body-md text-pure-white">{ap.merchant}</div>
                    <div className="text-label-sm text-on-surface-variant mt-1">{formatINR(ap.amount)} · {ap.cycle} · Next: {ap.nextDate}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleToggleAutopay(ap.id)} className={`text-label-sm px-3 py-1 rounded-full border transition-colors ${ap.active ? "border-electric-blue/40 text-electric-blue bg-electric-blue/10" : "border-outline-variant text-on-surface-variant"}`}>
                      {ap.active ? "Active" : "Paused"}
                    </button>
                    <button onClick={() => handleDeleteAutopay(ap.id)} className="text-error hover:text-error/80 transition-colors">
                      <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PIN Reveal Modal */}
      {pinRevealModal && (
        <Modal title="Enter PIN to Reveal" onClose={() => setPinRevealModal(false)}>
          <input type="password" maxLength={4} placeholder="4-digit PIN" value={pinRevealInput} onChange={(e) => setPinRevealInput(e.target.value)}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-4 focus:outline-none focus:border-primary" />
          <button onClick={() => handleReveal(pinRevealInput)} disabled={revealLoading || pinRevealInput.length !== 4}
            className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors disabled:opacity-50">
            {revealLoading ? "Verifying..." : "Reveal"}
          </button>
        </Modal>
      )}

      {/* PIN Modal */}
      {pinModal && (
        <Modal title={card.hasPin ? "Change PIN" : "Set PIN"} onClose={() => setPinModal(false)}>
          {card.hasPin && (
            <input type="password" maxLength={4} placeholder="Current PIN" value={pinForm.currentPin} onChange={(e) => setPinForm((f) => ({ ...f, currentPin: e.target.value }))}
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-3 focus:outline-none focus:border-primary" />
          )}
          <input type="password" maxLength={4} placeholder="New PIN (4 digits)" value={pinForm.newPin} onChange={(e) => setPinForm((f) => ({ ...f, newPin: e.target.value }))}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-4 focus:outline-none focus:border-primary" />
          <button onClick={handlePin} disabled={pinLoading || pinForm.newPin.length !== 4}
            className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors disabled:opacity-50">
            {pinLoading ? "Saving..." : "Save PIN"}
          </button>
        </Modal>
      )}

      {/* Spending Limit Modal */}
      {limitModal && (
        <Modal title="Set Daily Spending Limit" onClose={() => setLimitModal(false)}>
          <input type="number" min="0" placeholder="Amount in INR (leave empty to remove)" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-4 focus:outline-none focus:border-primary" />
          <button onClick={handleSpendingLimit} disabled={limitLoading}
            className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors disabled:opacity-50">
            {limitLoading ? "Saving..." : limitAmount === "" ? "Remove Limit" : "Set Limit"}
          </button>
        </Modal>
      )}

      {/* Autopay Modal */}
      {autopayModal && (
        <Modal title="Add Autopay" onClose={() => setAutopayModal(false)}>
          <input type="text" placeholder="Merchant name" value={autopayForm.merchant} onChange={(e) => setAutopayForm((f) => ({ ...f, merchant: e.target.value }))}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-3 focus:outline-none focus:border-primary" />
          <input type="number" min="0" placeholder="Amount (INR)" value={autopayForm.amount} onChange={(e) => setAutopayForm((f) => ({ ...f, amount: e.target.value }))}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-3 focus:outline-none focus:border-primary" />
          <select value={autopayForm.cycle} onChange={(e) => setAutopayForm((f) => ({ ...f, cycle: e.target.value }))}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-4 focus:outline-none focus:border-primary">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <button onClick={handleAddAutopay} disabled={autopayLoading || !autopayForm.merchant || !autopayForm.amount}
            className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors disabled:opacity-50">
            {autopayLoading ? "Adding..." : "Add Autopay"}
          </button>
        </Modal>
      )}

      {/* New Card Details Modal — shown once after issuance */}
      {newCardDetails && (
        <Modal title="Your New Card Details" onClose={() => setNewCardDetails(null)}>
          <p className="text-label-sm text-on-surface-variant mb-4">Save these details — the full number won&apos;t be shown again without your PIN.</p>
          <div className="space-y-3 mb-5">
            <div className="bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3">
              <div className="text-label-xs text-on-surface-variant mb-1">Card Number</div>
              <div className="text-body-md text-pure-white font-mono tracking-widest">
                {newCardDetails.fullNumber?.replace(/(\d{4})/g, "$1 ").trim()}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3">
                <div className="text-label-xs text-on-surface-variant mb-1">Expiry</div>
                <div className="text-body-md text-pure-white font-mono">{newCardDetails.expiry}</div>
              </div>
              <div className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3">
                <div className="text-label-xs text-on-surface-variant mb-1">CVV</div>
                <div className="text-body-md text-pure-white font-mono">{newCardDetails.cvv}</div>
              </div>
            </div>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(newCardDetails.fullNumber); toast.success("Copied"); }}
            className="w-full bg-surface-variant border border-outline-variant text-on-surface py-2 rounded-lg text-label-md mb-3 hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[18px]">content_copy</span> Copy Number
          </button>
          <button onClick={() => setNewCardDetails(null)}
            className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors">
            Done
          </button>
        </Modal>
      )}

      {/* Issue Card Modal */}
      {issueModal && (
        <Modal title="Get a New Card" onClose={() => setIssueModal(false)}>
          <input type="text" placeholder="Card name (optional)" value={issueForm.name} onChange={(e) => setIssueForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-3 focus:outline-none focus:border-primary" />
          <select value={issueForm.cardType} onChange={(e) => setIssueForm((f) => ({ ...f, cardType: e.target.value }))}
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-4 py-3 text-on-surface text-body-md mb-4 focus:outline-none focus:border-primary">
            <option value="virtual">Virtual</option>
            <option value="physical">Physical</option>
          </select>
          <button onClick={handleIssueCard} disabled={issueLoading}
            className="w-full bg-electric-blue text-pure-white py-3 rounded-lg text-label-md hover:bg-inverse-primary transition-colors disabled:opacity-50">
            {issueLoading ? "Generating..." : "Generate Card"}
          </button>
        </Modal>
      )}
    </>
  );
}
