/**
 * The shared surface kit, transcribed from the web app's mobile stylesheet.
 *
 * Every piece here has a counterpart in `frontend/src/index.css`, named in its
 * comment, so the two clients drift together rather than apart. Screens
 * compose these instead of styling their own.
 */
import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Modal, Pressable,
  ScrollView, StyleSheet, Text, View,
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

export const prefersReducedMotion = (): boolean => reduceMotion;

/**
 * Page entrance. The web animates sections in reading order with a short
 * upward settle (`runLoginEntrance`, `auth-form-in`); this is the same idea
 * with a ~45ms stagger. Reduce-motion skips straight to the resting state.
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
      duration: 280,
      delay: Math.min(index, 9) * 45,
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
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Press feedback: a 98% dip, as the web's `:active` transforms do. */
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

/** `.glass-card` — on mobile a flat `#111111` panel with a slate hairline. */
export function Card({
  children,
  style,
  onPress,
  onLongPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
}) {
  if (!onPress && !onLongPress) return <View style={[shared.card, style]}>{children}</View>;
  return (
    <Pressed
      onPress={onPress}
      onLongPress={onLongPress}
      style={[shared.card, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressed>
  );
}

/** `.section-kicker`. */
export function Kicker({ children }: { children: string }) {
  return <Text style={type.kicker}>{children}</Text>;
}

/**
 * `.card-heading` — kicker + h2 on the left, an optional text button on the
 * right, 14px of air beneath.
 */
export function CardHeading({
  kicker,
  title,
  actionLabel,
  onAction,
  trailing,
}: {
  kicker?: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  trailing?: React.ReactNode;
}) {
  const { accent } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: space.md,
        marginBottom: 14,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        {!!kicker && <Kicker>{kicker}</Kicker>}
        <Text style={type.h2}>{title}</Text>
      </View>
      {trailing}
      {!!actionLabel && !!onAction && (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 36 }}
        >
          <Text style={[type.action, { color: accent }]}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color={accent} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * `.page-heading` — eyebrow, h1, lede, and an optional 44px round primary
 * action on the right.
 */
export function PageHeading({
  eyebrow,
  title,
  lede,
  actionIcon,
  actionLabel,
  onAction,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  actionIcon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { accent, colorMode } = useTheme();
  return (
    <FadeIn index={0}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={type.eyebrow}>{eyebrow}</Text>
          <Text style={[type.h1, { marginTop: 6, marginBottom: 6 }]}>{title}</Text>
          {!!lede && <Text style={type.lede}>{lede}</Text>}
        </View>
        {!!actionIcon && !!onAction && (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel ?? 'Add'}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              marginTop: 2,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colorMode ? accent : colors.text,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name={actionIcon} size={20} color="#000000" />
          </Pressable>
        )}
      </View>
    </FadeIn>
  );
}

/** `.data-banner` / `.data-banner-error`. */
export function DataBanner({ message, error }: { message: string; error?: boolean }) {
  return (
    <View
      accessibilityLiveRegion={error ? 'assertive' : 'polite'}
      accessibilityRole={error ? 'alert' : undefined}
      style={{
        marginBottom: space.md,
        paddingHorizontal: 15,
        paddingVertical: 11,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: error ? colors.dangerBorder : 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.04)',
      }}
    >
      <Text style={{ color: error ? colors.danger : 'rgba(255,255,255,0.65)', fontSize: 13 }}>
        {message}
      </Text>
    </View>
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
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressed
      onPress={onPress}
      disabled={disabled || busy}
      style={[shared.primaryButton, (disabled || busy) && { opacity: 0.55 }, style]}
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#000000" />
      ) : (
        <Text style={shared.primaryLabel}>{label}</Text>
      )}
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
      style={[shared.ghostButton, disabled && { opacity: 0.55 }, style]}
      accessibilityLabel={label}
    >
      <Text style={shared.ghostLabel}>{label}</Text>
    </Pressed>
  );
}

/**
 * `.library-categories button` — the primary pill row. Active is a white
 * fill (violet-bordered in Color Mode), as on the web.
 */
export function CategoryChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const { colorMode, accent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      style={{
        height: 40,
        paddingHorizontal: 17,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active
          ? colorMode
            ? accent
            : colors.text
          : colors.borderStrong,
        backgroundColor: active ? colors.text : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: active ? '#000000' : colors.textMuted,
          fontSize: 14,
          fontWeight: '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * `.library-filters button` — the secondary pill row: borderless, a soft
 * translucent fill when active.
 */
export function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const { colorMode, accent } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      style={{
        height: 34,
        paddingHorizontal: 13,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active
          ? colorMode
            ? 'rgba(182,154,245,0.4)'
            : 'rgba(255,255,255,0.22)'
          : 'transparent',
        backgroundColor: active
          ? colorMode
            ? 'rgba(182,154,245,0.1)'
            : 'rgba(255,255,255,0.1)'
          : 'rgba(255,255,255,0.05)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: active ? (colorMode ? accent : colors.text) : colors.textMuted,
          fontSize: 12.5,
          fontWeight: active ? '600' : '400',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** `.segmented` — the Day / Week / Month control, 44px tall on mobile. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { colorMode, accent } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        height: 44,
        padding: 3,
        borderRadius: radius.sm,
        backgroundColor: 'rgba(255,255,255,0.06)',
      }}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={{
              flex: 1,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected
                ? colorMode
                  ? 'rgba(182,154,245,0.16)'
                  : colors.text
                : 'transparent',
            }}
          >
            <Text
              style={{
                color: selected ? (colorMode ? accent : '#000000') : colors.textMuted,
                fontSize: 13.5,
                fontWeight: selected ? '600' : '400',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * `.progress` — a 4px track at 16% white with a white fill, which Color Mode
 * turns into the violet-to-cyan gradient (approximated with the accent).
 */
export function Progress({
  value,
  style,
}: {
  /** 0..1 */
  value: number;
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
          height: 4,
          borderRadius: 5,
          backgroundColor: 'rgba(255,255,255,0.16)',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: 5,
          backgroundColor: accent,
        }}
      />
    </View>
  );
}

/** `.mobile-nav-actions button i` — the small ring that fills when on. */
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
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 15 }}>{title}</Text>
        {!!subtitle && <Text style={type.meta}>{subtitle}</Text>}
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
            backgroundColor: value ? '#000000' : colors.textMuted,
          }}
        />
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------------ */
/* Empty states                                                              */
/* ------------------------------------------------------------------------ */

/** `.health-empty-state` / `.library-empty` — centred icon, title, line. */
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
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 34, gap: 9 }}>
      <Ionicons name={icon} size={26} color={colors.textFaint} />
      <Text style={[type.h3, { marginTop: 2, textAlign: 'center' }]}>{title}</Text>
      {!!body && (
        <Text style={[type.meta, { textAlign: 'center', maxWidth: 280 }]}>{body}</Text>
      )}
      {action}
    </View>
  );
}

/** `.mobile-month-empty` — the dashed inline note. */
export function DashedNote({ children }: { children: string }) {
  return (
    <View
      style={{
        paddingHorizontal: space.md,
        paddingVertical: 18,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.borderStrong,
        borderRadius: radius.lg,
      }}
    >
      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13.5, textAlign: 'center' }}>
        {children}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Bottom sheet                                                              */
/* ------------------------------------------------------------------------ */

/**
 * The web's modals become bottom sheets on mobile: full width, 26px top
 * corners, 92svh cap, entering with `mobile-sheet-in`.
 */
export function Sheet({
  visible,
  onClose,
  title,
  kicker,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  kicker?: string;
  children: React.ReactNode;
}) {
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(slide, {
        toValue: 1,
        duration: reduceMotion ? 0 : 320,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(slide, {
        toValue: 0,
        duration: reduceMotion ? 0 : 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, slide]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', opacity: slide }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '92%',
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) },
          ],
          backgroundColor: '#0a0a0a',
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          borderTopWidth: 1,
          borderColor: colors.borderStrong,
          paddingTop: 10,
          paddingHorizontal: 18,
          paddingBottom: 28,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 36,
            height: 4,
            borderRadius: radius.pill,
            backgroundColor: 'rgba(255,255,255,0.18)',
            marginBottom: 14,
          }}
        />
        {(!!kicker || !!title) && (
          <View style={{ gap: 5, marginBottom: space.md }}>
            {!!kicker && <Kicker>{kicker}</Kicker>}
            {!!title && <Text style={[type.h2, { fontSize: 21 }]}>{title}</Text>}
          </View>
        )}
        {children}
      </Animated.View>
    </Modal>
  );
}

/* ------------------------------------------------------------------------ */
/* Covers                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * `.learning-thumbnail` — the web shows a cover image when it has one and a
 * glyph on a translucent tile when it does not. The phone has no covers to
 * show yet, so it draws the tile with the title's initial.
 */
export function Thumbnail({
  title,
  icon = 'book',
  width,
  height,
  rounded = 10,
}: {
  title: string;
  icon?: IconName;
  width: number;
  height: number;
  rounded?: number;
}) {
  const initial = (title.trim()[0] ?? '?').toUpperCase();
  return (
    <View
      style={{
        width,
        height,
        borderRadius: rounded,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.07)',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        gap: 4,
      }}
    >
      <Text style={{ color: colors.text, fontSize: Math.min(width, height) * 0.3, fontWeight: '600' }}>
        {initial}
      </Text>
      <Ionicons name={icon} size={13} color="rgba(255,255,255,0.45)" />
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
      }, 2400);
    },
    [opacity],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
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
            bottom: 150,
            opacity,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: '#1a1a1a',
              borderColor: colors.borderStrong,
              borderWidth: 1,
              borderRadius: radius.sm,
              paddingHorizontal: 16,
              paddingVertical: 11,
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

/** `.symptom-tags span` / `.detail-tags span` — the small chip. */
export function Tag({ children }: { children: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.06)',
      }}
    >
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{children}</Text>
    </View>
  );
}

/** `.recovery-status` — the outlined status pill. */
export function StatusPill({ label, tone }: { label: string; tone?: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: tone ?? colors.divider,
      }}
    >
      <Text style={{ color: tone ?? colors.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** A horizontally scrolling pill row that keeps the page gutter. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginHorizontal: -space.gutter, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: space.gutter, gap: 8 }}
    >
      {children}
    </ScrollView>
  );
}

/** A metadata line: small icon plus text. */
export function MetaRow({
  icon,
  children,
  tone = colors.textSoft,
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

/** Full-screen loading, matching the web's quiet spinner. */
export function Loading() {
  return (
    <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator color={colors.text} />
    </View>
  );
}
