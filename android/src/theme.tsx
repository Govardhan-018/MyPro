/**
 * MyPro design tokens — the MYPRO 2.0 visual language.
 *
 * Near-black layered backgrounds (never pure #000 against pure #fff outlines),
 * graphite surfaces at three elevations, type with a size-based hierarchy, and
 * hairline borders at ~9% white. Color Mode introduces one restrained violet
 * accent; monochrome stays the default, exactly as on the web.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const colors = {
  /** Page background — a near-black with a hint of blue, softer than #000. */
  background: '#050607',
  /** Secondary background (sheets, grouped areas). */
  backgroundRaised: '#0B0D10',
  /** Standard card surface. */
  surface: '#111317',
  /** Elevated surface — floating controls, active chips, sheet headers. */
  surfaceHigh: '#191C22',
  /** A translucent "glass" wash for floating chrome over content. */
  glass: 'rgba(17,19,23,0.92)',

  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.16)',
  /** A faint inner highlight line for elevated surfaces. */
  highlight: 'rgba(255,255,255,0.05)',

  text: '#F5F5F7',
  textStrong: '#E8E8EC',
  textMuted: '#A0A4AD',
  textFaint: '#737983',

  /** Restrained violet — only reaches the UI when Color Mode is on. */
  violet: '#A88CF2',
  violetDim: 'rgba(168,140,242,0.16)',
  danger: '#F2917E',
};

/** The 8px spacing system. */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  /** Side gutter for every page. */
  gutter: 20,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
};

/** Typography scale — sizes only; weight and spacing live in `type` below. */
export const type = StyleSheet.create({
  /** Main page heading. */
  title: { color: colors.text, fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  /** Section heading. */
  heading: { color: colors.text, fontSize: 23, fontWeight: '600', letterSpacing: -0.4 },
  /** Card heading. */
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.2 },
  /** Body. */
  body: { color: colors.textStrong, fontSize: 15.5, lineHeight: 23 },
  /** Supporting text. */
  support: { color: colors.textMuted, fontSize: 13.5, lineHeight: 19 },
  /** Small labels and metadata. */
  label: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  /** Uppercase section eyebrow. */
  eyebrow: {
    color: colors.textFaint,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    fontWeight: '600',
  },
});

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.md + 2,
    gap: space.sm,
  },
  /** Elevated card — floating sheets, prominent surfaces. */
  cardHigh: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.borderStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.md + 2,
    gap: space.sm,
  },
  title: type.title,
  muted: type.support,
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.text,
  },
  buttonLabel: { color: colors.background, fontSize: 15, fontWeight: '600' },
  ghostButton: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  ghostLabel: { color: colors.textStrong, fontSize: 14, fontWeight: '500' },
});

/* ------------------------------------------------------------------------ */
/* Color Mode                                                                */
/* ------------------------------------------------------------------------ */

const COLOR_MODE_KEY = 'mypro.colorMode';

interface ThemeState {
  /** Whether Color Mode (the violet accent) is on. */
  colorMode: boolean;
  /** The accent to paint interactive emphasis with right now. */
  accent: string;
  /** A translucent wash of the accent, for fills behind accent content. */
  accentSoft: string;
  setColorMode: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeState>({
  colorMode: false,
  accent: colors.text,
  accentSoft: 'rgba(255,255,255,0.1)',
  setColorMode: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [colorMode, setColorModeState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(COLOR_MODE_KEY)
      .then((stored) => {
        if (stored === '1') setColorModeState(true);
      })
      .catch(() => undefined);
  }, []);

  const setColorMode = useCallback((on: boolean) => {
    setColorModeState(on);
    AsyncStorage.setItem(COLOR_MODE_KEY, on ? '1' : '0').catch(() => undefined);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      colorMode,
      accent: colorMode ? colors.violet : colors.text,
      accentSoft: colorMode ? colors.violetDim : 'rgba(255,255,255,0.1)',
      setColorMode,
    }),
    [colorMode, setColorMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ThemeState => useContext(ThemeContext);
