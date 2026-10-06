"use client";
import { useState, useEffect, useCallback, createContext, useContext } from "react";

/* ─── Toast Context ─── */
const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/* ─── Toast Provider ─── */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info", duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, type, duration) => addToast(message, type, duration),
    [addToast]
  );
  toast.success = (msg, dur) => addToast(msg, "success", dur);
  toast.error = (msg, dur) => addToast(msg, "error", dur);
  toast.info = (msg, dur) => addToast(msg, "info", dur);
  toast.comingSoon = (feature) => addToast(`${feature} — coming soon`, "info", 3000);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast Container */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col-reverse gap-3 pointer-events-none max-w-sm w-full">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ─── Single Toast ─── */
function ToastItem({ toast, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const icons = {
    success: "check_circle",
    error: "error",
    info: "info",
  };
  const colors = {
    success: "text-green-400 border-green-500/30 bg-green-500/10",
    error: "text-error border-error/30 bg-error-container/20",
    info: "text-electric-blue border-electric-blue/30 bg-electric-blue/10",
  };

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-lg transition-all duration-300 ${
        colors[toast.type]
      } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      style={{ background: "rgba(12, 13, 24, 0.85)" }}
    >
      <span
        className="material-symbols-outlined text-[20px]"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icons[toast.type]}
      </span>
      <span className="text-label-md text-on-surface flex-1">{toast.message}</span>
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => onDismiss(toast.id), 300);
        }}
        className="text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}
