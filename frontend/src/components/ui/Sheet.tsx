import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";

/**
 * Sheet (UI upgrade §3.6) — the one bottom sheet; replaces the app's modals.
 * Spring-up, backdrop fade, drag handle, drag-to-dismiss past 25% / fast flick,
 * Esc to close, scroll locked behind it. Reduced motion → an opacity fade.
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const el = ref.current;
    const far = el ? info.offset.y > el.offsetHeight * 0.25 : info.offset.y > 120;
    if (far || info.velocity.y > 500) onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.66)", zIndex: 1000 }}
          />
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 260, damping: 26 }}
            drag={reduce ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1001,
              maxHeight: "90vh",
              background: "var(--surface-2)",
              borderTopLeftRadius: "var(--r-xl)",
              borderTopRightRadius: "var(--r-xl)",
              boxShadow: "var(--e2)",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
              display: "flex",
              flexDirection: "column",
              outline: "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
              <div style={{ width: 40, height: 4, borderRadius: 999, background: "var(--border-strong)" }} />
            </div>
            {title ? (
              <h2 className="ds-headline" style={{ margin: "6px 20px 8px", color: "var(--text-1)" }}>
                {title}
              </h2>
            ) : null}
            <div style={{ overflowY: "auto", padding: "0 20px 4px" }}>{children}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
