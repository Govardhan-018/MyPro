/**
 * MyPro's reusable surface kit — MYPRO 2.0.
 *
 * One animation system, one card language, one bottom sheet. Every screen
 * composes these instead of styling its own, which is what keeps the app
 * feeling like a single product. Entrance animation respects the system's
 * reduce-motion setting.
 */
import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shared, space, type, useTheme } from '../theme';

export type IconName = keyof typeof Ionicons.glyphMap;

/* ------------------------------------------------------------------------ */
/* Motion                                                                    */
/* ------------------------------------------------------------------------ */

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => {
    reduceMotion = on;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
  reduceMotion = on;
});

/**
 * Entrance: fade + a small downward settle, staggered ~45ms per index so a
 * page builds top-to-bottom in reading order. With reduce-motion on, content
 * simply appears.
 */
export function FadeIn({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index, 10) * 45,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-10, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A press-scale wrapper: cards and buttons dip to 98% while touched. */
export function Pressed({
  onPress,
  onLongPress,
  disabled,
  style,
  children,
  accessibilityLabel,
  accessibilityRole = 'button',
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'tab' | 'link';
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.timing(scale, {
      toValue: value,
      duration: 110,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onPressIn={() => !reduceMotion && to(0.98)}
      onPressOut={() => !reduceMotion && to(1)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------------ */
/* Surfaces                                                                  */
/* ------------------------------------------------------------------------ */

export function Card({
  children,
  style,
  onPress,
  onLongPress,
  elevated,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  elevated?: boolean;
  accessibilityLabel?: string;
}) {
  const base = elevated ? shared.cardHigh : shared.card;
  if (!onPress && !onLongPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressed
      onPress={onPress}
      onLongPress={onLongPress}
      style={[base, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressed>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={[type.eyebrow, { marginBottom: 2 }]}>{children}</Text>;
}

/** Large page header: title, optional subtitle, optional right-side actions. */
export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <FadeIn index={0}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={type.title}>{title}</Text>
          {!!subtitle && <Text style={type.support}>{subtitle}</Text>}
        </View>
        {right}
      </View>
    </FadeIn>
  );
}

/** A small round icon button for headers and toolbars. */
export function IconButton({
  icon,
  onPress,
  label,
  active,
  size = 20,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  active?: boolean;
  size?: number;
}) {
  const { accent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed || active ? colors.surfaceHigh : 'transparent',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: pressed || active ? colors.borderStrong : 'transparent',
      })}
    >
      <Ionicons name={icon} size={size} color={active ? accent : colors.textMuted} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------------ */
/* Controls                                                                  */
/* ------------------------------------------------------------------------ */

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressed
      onPress={onPress}
      disabled={disabled || busy}
      style={[shared.button, (disabled || busy) && { opacity: 0.45 }]}
      accessibilityLabel={label}
    >
      <Text style={shared.buttonLabel}>{busy ? '…' : label}</Text>
    </Pressed>
  );
}

export function GhostButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressed
      onPress={onPress}
      disabled={disabled}
      style={[shared.ghostButton, disabled && { opacity: 0.45 }, style]}
      accessibilityLabel={label}
    >
      <Text style={shared.ghostLabel}>{label}</Text>
    </Pressed>
  );
}

/** Filter chip. Active state uses the theme accent (violet in Color Mode). */
export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  const { colorMode, accent, accentSoft } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? (colorMode ? accentSoft : colors.text) : colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? (colorMode ? accent : colors.text) : colors.border,
      }}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={13}
          color={active ? (colorMode ? accent : colors.background) : colors.textMuted}
        />
      )}
      <Text
        style={{
          color: active ? (colorMode ? accent : colors.background) : colors.textMuted,
          fontSize: 13,
          fontWeight: active ? '600' : '400',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A thin determinate progress bar, accent-aware. */
export function ProgressBar({
  value,
  height = 4,
  style,
}: {
  /** 0..1 */
  value: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { accent } = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      style={[
        {
          height,
          borderRadius: height,
          backgroundColor: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: height,
          backgroundColor: accent,
        }}
      />
    </View>
  );
}

/** A labelled on/off switch row (custom-drawn: consistent across OS skins). */
export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { accent, colorMode } = useTheme();
  const on = colorMode ? accent : colors.text;
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: 15.5 }}>{title}</Text>
        {!!subtitle && <Text style={type.support}>{subtitle}</Text>}
      </View>
      <View
        style={{
          width: 46,
          height: 28,
          borderRadius: 14,
          padding: 3,
          backgroundColor: value ? on : 'rgba(255,255,255,0.1)',
          alignItems: value ? 'flex-end' : 'flex-start',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: value ? colors.background : colors.textMuted,
          }}
        />
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------------ */
/* Empty / message states                                                    */
/* ------------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={[shared.card, { alignItems: 'center', paddingVertical: space.xl, gap: 10 }]}>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceHigh,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
      >
        <Ionicons name={icon} size={22} color={colors.textMuted} />
      </View>
      <Text style={[type.cardTitle, { textAlign: 'center' }]}>{title}</Text>
      {!!body && (
        <Text style={[type.support, { textAlign: 'center', maxWidth: 280 }]}>{body}</Text>
      )}
      {action}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Bottom sheet                                                              */
/* ------------------------------------------------------------------------ */

export function Sheet({
  visible,
  onClose,
  title,
  children,
  /** Extra bottom padding content wants (defaults to safe-area-ish 34). */
  padBottom = 34,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  padBottom?: number;
}) {
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(slide, {
        toValue: 1,
        duration: reduceMotion ? 0 : 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(slide, {
        toValue: 0,
        duration: reduceMotion ? 0 : 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, mounted, slide]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.72)',
          opacity: slide,
          justifyContent: 'flex-end',
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          style={{
            transform: [
              { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) },
            ],
            backgroundColor: colors.backgroundRaised,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: colors.borderStrong,
            paddingTop: 10,
            paddingHorizontal: space.gutter,
            paddingBottom: padBottom,
            maxHeight: '86%',
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: 'rgba(255,255,255,0.18)',
              marginBottom: 12,
            }}
          />
          {!!title && (
            <Text style={[type.cardTitle, { marginBottom: space.md }]}>{title}</Text>
          )}
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */
/* Covers                                                                    */
/* ------------------------------------------------------------------------ */

const COVER_TONES = ['#1C2026', '#20242E', '#231F2B', '#1E2622', '#262019'];

/**
 * Elegant placeholder cover for a document with no artwork: a quiet tinted
 * panel with the title's initial, deterministic per title so the shelf stays
 * stable between visits.
 */
export function PlaceholderCover({
  title,
  width,
  height,
  rounded = radius.md,
}: {
  title: string;
  width: number;
  height: number;
  rounded?: number;
}) {
  const tone = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0;
    return COVER_TONES[Math.abs(hash) % COVER_TONES.length];
  }, [title]);

  return (
    <View
      style={{
        width,
        height,
        borderRadius: rounded,
        backgroundColor: tone,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: height * 0.4,
          backgroundColor: colors.highlight,
        }}
      />
      <Text
        style={{
          color: colors.textMuted,
          fontSize: Math.min(width, height) * 0.34,
          fontWeight: '700',
        }}
      >
        {(title.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Toasts                                                                    */
/* ------------------------------------------------------------------------ */

interface ToastState {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastState>({ show: () => undefined });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useMemo(
    () => (next: string) => {
      setMessage(next);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, {
        toValue: 1,
        duration: reduceMotion ? 0 : 180,
        useNativeDriver: true,
      }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: reduceMotion ? 0 : 240,
          useNativeDriver: true,
        }).start(() => setMessage(null));
      }, 2200);
    },
    [opacity],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message !== null && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: space.gutter,
            right: space.gutter,
            bottom: 108,
            opacity,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: colors.surfaceHigh,
              borderColor: colors.borderStrong,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: radius.md,
              paddingHorizontal: 16,
              paddingVertical: 10,
              maxWidth: 420,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 13.5 }}>{message}</Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastState => useContext(ToastContext);

/* ------------------------------------------------------------------------ */
/* Misc                                                                      */
/* ------------------------------------------------------------------------ */

/** Metadata row: icon + text, used on schedule/event/record cards. */
export function MetaRow({
  icon,
  children,
  tone = colors.textFaint,
}: {
  icon: IconName;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Ionicons name={icon} size={13} color={tone} />
      <Text style={{ color: tone, fontSize: 12.5, flexShrink: 1 }}>{children}</Text>
    </View>
  );
}
