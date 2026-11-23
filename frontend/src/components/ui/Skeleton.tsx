import { useEffect, useRef, useState } from "react";

/**
 * Skeleton primitives (UI upgrade §3.2). The shimmer itself (`.ds-shimmer`, a
 * synced left→right sweep, stilled under reduced motion) lives in tokens.css so
 * every skeleton shares one animation. Compose these into per-screen skeletons
 * whose dimensions exactly match the real content, so loading causes no layout
 * shift (CLS ≈ 0).
 */
type Dim = number | string;

export function SkeletonLine({ width = "100%", height = 12, radius = 6 }: {
  width?: Dim;
  height?: Dim;
  radius?: number;
}) {
  return <div className="ds-shimmer" style={{ width, height, borderRadius: radius }} aria-hidden />;
}

export function SkeletonBlock({ width = "100%", height = 80, radius = 12 }: {
  width?: Dim;
  height?: Dim;
  radius?: number;
}) {
  return <div className="ds-shimmer" style={{ width, height, borderRadius: radius }} aria-hidden />;
}

export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return <div className="ds-shimmer" style={{ width: size, height: size, borderRadius: "50%" }} aria-hidden />;
}

/**
 * Show a skeleton only if loading lasts past `delay` (no flash on fast loads),
 * and keep it visible at least `minVisible` once shown (no flicker). Returns
 * whether the skeleton should render.
 */
export function useDelayedSkeleton(loading: boolean, delay = 300, minVisible = 400): boolean {
  const [show, setShow] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    if (loading) {
      if (!show) {
        timer = window.setTimeout(() => {
          shownAt.current = Date.now();
          setShow(true);
        }, delay);
      }
    } else if (show) {
      const elapsed = shownAt.current ? Date.now() - shownAt.current : minVisible;
      timer = window.setTimeout(() => {
        shownAt.current = null;
        setShow(false);
      }, Math.max(0, minVisible - elapsed));
    }
    return () => window.clearTimeout(timer);
  }, [loading, show, delay, minVisible]);

  return show;
}
