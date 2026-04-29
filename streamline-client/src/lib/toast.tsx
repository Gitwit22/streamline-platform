/**
 * Global Toast System — Lightweight notification toasts
 *
 * Usage:
 *   import { ToastProvider, useToast } from "../lib/toast";
 *
 *   // In App root:
 *   <ToastProvider> ... </ToastProvider>
 *
 *   // Anywhere in the tree:
 *   const toast = useToast();
 *   toast.show({ title: "Done", description: "It worked." });
 *   toast.show({ title: "Error", variant: "destructive" });
 *   toast.show({ title: "Ready", action: { label: "Open", onClick: () => nav("/x") } });
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

export type ToastVariant = "default" | "success" | "destructive";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  action?: ToastAction;
  duration?: number; // ms, default 6000
}

interface ToastContextValue {
  show: (toast: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const show = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `toast-${++toastCounter}`;
    const item: ToastItem = { ...toast, id };
    setToasts((prev) => [...prev, item]);
    const duration = toast.duration ?? 6000;
    timersRef.current[id] = setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Toast container */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 99999,
            display: "flex",
            flexDirection: "column-reverse",
            gap: 10,
            maxWidth: "min(420px, calc(100vw - 48px))",
            pointerEvents: "none",
          }}
        >
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const borderColor =
    toast.variant === "destructive"
      ? "rgba(239,68,68,0.5)"
      : toast.variant === "success"
        ? "rgba(16,185,129,0.5)"
        : "rgba(255,255,255,0.15)";

  const iconColor =
    toast.variant === "destructive"
      ? "#ef4444"
      : toast.variant === "success"
        ? "#10b981"
        : "#3b82f6";

  return (
    <div
      style={{
        pointerEvents: "auto",
        background: "rgba(15,23,42,0.97)",
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        padding: "12px 16px",
        color: "#e5e7eb",
        boxShadow: "0 18px 60px rgba(0,0,0,0.6)",
        backdropFilter: "blur(12px)",
        animation: "toast-slide-in 0.25s ease-out",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ flexShrink: 0, fontSize: 18, color: iconColor, marginTop: 1 }}>
        {toast.variant === "destructive" ? "✕" : toast.variant === "success" ? "✓" : "ℹ"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#fff" }}>{toast.title}</div>
        {toast.description && (
          <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>
            {toast.description}
          </div>
        )}
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              onDismiss();
            }}
            style={{
              marginTop: 8,
              padding: "6px 14px",
              background: "linear-gradient(135deg, #dc2626, #ef4444)",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          color: "#6b7280",
          cursor: "pointer",
          fontSize: 16,
          padding: "0 4px",
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
      <style>{`@keyframes toast-slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}
