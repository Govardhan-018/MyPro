import { forwardRef } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

/**
 * Pressable — the one tappable wrapper (UI upgrade §3.1).
 *
 * Press = scale 0.97 (spring), release springs back. Only `transform` is
 * animated, so it stays at 60fps. Reduced motion drops the scale. An optional
 * 8ms haptic fires on primary actions only. Disabled = 40% opacity, no press.
 */
export type PressableProps = HTMLMotionProps<"button"> & {
  /** Fire navigator.vibrate(8) on press — primary actions only. */
  haptic?: boolean;
};

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(function Pressable(
  { haptic = false, onPointerDown, disabled, children, style, ...rest },
  ref,
) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      whileTap={disabled || reduce ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onPointerDown={(event) => {
        if (!disabled && haptic) navigator.vibrate?.(8);
        onPointerDown?.(event);
      }}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        color: "inherit",
        font: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        touchAction: "manipulation",
        ...style,
      }}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
