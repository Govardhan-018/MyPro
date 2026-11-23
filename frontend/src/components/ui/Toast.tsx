import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pressable } from "./Pressable";

export type ToastInput = {
  message: string;
  /** Optional action, e.g. Undo. Given one, the toast lingers 5s instead of 4s. */
  action?: { label: string; onPress: () => void };
  duration?: number;
};
type ToastItem = ToastInput & { id: number };

const ToastCtx = createContext<(toast: ToastInput) => void>(() => {});

/** Push a toast. One shows at a time; the rest queue. */
export const useToast = () => useContext(ToastCtx);

/**
 * ToastProvider (UI upgrade §3.7). Bottom, above the nav; slides up and fades;
 * auto-dismiss 4s (5s with an action); one visible at a time.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const reduce = useReducedMotion();

  const push = useCallback((toast: ToastInput) => {
    idRef.current += 1;
    setQueue((q) => [...q, { ...toast, id: idRef.current }]);
  }, []);

  const current = queue[0];
  const dismiss = useCallback(
    (id: number) => setQueue((q) => q.filter((t) => t.id !== id)),
    [],
  );

  useEffect(() => {
    if (!current) return;
    const ms = current.duration ?? (current.action ? 5000 : 4000);
    const timer = window.setTimeout(() => dismiss(current.id), ms);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "calc(env(safe-area-inset-bottom) + 84px)",
          display: "flex",
          justifyContent: "center",
          padding: "0 20px",
          pointerEvents: "none",
          zIndex: 1200,
        }}
      >
        <AnimatePresence>
          {current ? (
            <motion.div
              key={current.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: 12,
                maxWidth: 440,
                width: "100%",
                padding: "12px 16px",
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                boxShadow: "var(--e2)",
              }}
            >
              <span className="ds-callout" style={{ color: "var(--text-1)", flex: 1 }}>
                {current.message}
              </span>
              {current.action ? (
                <Pressable
                  haptic
                  onClick={() => {
                    current.action?.onPress();
                    dismiss(current.id);
                  }}
                  className="ds-callout"
                  style={{ color: "var(--accent)", fontWeight: 600, padding: "6px 4px" }}
                >
                  {current.action.label}
                </Pressable>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
