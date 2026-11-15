/**
 * MyPro's design tokens — lifted from the web app's own mobile stylesheet
 * (`frontend/src/index.css`, the `max-width: 760px` and `1023px` blocks) so
 * the phone and the browser are recognisably one product.
 *
 * The web's `:root` custom properties are all `#ffffff` (the Phase 18.2
 * defect), so the real values live in the component rules, and those are what
 * is transcribed here: a pure black canvas, `#111111` surfaces, borders in
 * the slate `rgba(86,94,103,…)` family, white type over five opacity tiers,
 * and one violet accent that only appears in Color Mode.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const colors = {
  /** The app canvas. `.dark-app.app-shell` on mobile: flat black. */
  background: '#000000',
  /** Every card and tile on mobile. */
  surface: '#111111',
  /** The pressed/active surface of a header button. */
  surfaceActive: '#202020',
  /** Floating chrome (nav sheet, header) sits on near-opaque black. */
  chrome: 'rgba(0,0,0,0.92)',
  header: 'rgba(0,0,0,0.82)',

  /** Card borders — the slate line the mobile design uses throughout. */
  border: 'rgba(86,94,103,0.45)',
  borderStrong: 'rgba(86,94,103,0.55)',
  /** Hairline dividers inside cards. */
  divider: 'rgba(255,255,255,0.08)',
  dividerFaint: 'rgba(255,255,255,0.04)',

  /** Type tiers, as the mobile CSS uses them. */
  text: '#ffffff',
  textStrong: 'rgba(255,255,255,0.82)',
  /** Body copy under a heading (`.page-heading p`). */
  textBody: 'rgba(255,255,255,0.58)',
  /** Secondary labels (`.mobile-day-strip` idle, filter chips). */
  textMuted: 'rgba(255,255,255,0.6)',
  /** Tertiary (`.mobile-agenda-summary span`). */
  textSoft: 'rgba(255,255,255,0.48)',
  /** Quietest (`.bottom-nav button`, `.month-weekdays span`). */
  textFaint: 'rgba(255,255,255,0.42)',

  /** `.data-banner-error`. */
  danger: '#f8a3a3',
  dangerBorder: 'rgba(248,113,113,0.35)',

  /** Color Mode. `--accent`/`--deep` become this violet. */
  violet: '#b69af5',
  violetDeep: '#9168dc',
  violetSoft: 'rgba(182,154,245,0.16)',
  violetLine: 'rgba(182,154,245,0.6)',
  violetFill: 'rgba(145,104,220,0.2)',
} as const;

/** The four event tones, as Color Mode defines them. */
export const tones = {
  lavender: '#9168dc',
  blue: '#71b7f5',
  mint: '#f49aa6',
  peach: '#83d9b0',
} as const;

export type ToneName = keyof typeof tones;

/** 8px rhythm, with the web's 16px mobile page gutter. */
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  /** `.page-content { padding: 22px 16px 28px }`. */
  gutter: 16,
} as const;

export const radius = {
  /** `.mobile-nav-actions button`. */
  sm: 12,
  /** `.mobile-nav-card`. */
  md: 14,
  /** `.library-search`, `.collection-row`. */
  lg: 16,
  /** `.mobile-agenda-event`, `.learning-row`, `.mobile-day-strip button`. */
  xl: 18,
  /** `.dark-app .glass-card` on mobile. */
  card: 20,
  /** Bottom sheets. */
  sheet: 26,
  pill: 999,
} as const;

/**
 * Type scale, straight from the mobile rules. Sizes are the web's; nothing
 * here is invented.
 */
export const type = StyleSheet.create({
  /** `.page-heading h1` — 29px / 1.1, weight 600, tight. */
  h1: {
    color: colors.text,
    fontSize: 29,
    lineHeight: 32,
    fontWeight: '600',
    letterSpacing: -1.3,
  },
  /** `.page-heading .eyebrow` — 11px, 0.14em tracking. */
  eyebrow: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
  },
  /** `.page-heading p` — 14px / 1.45. */
  lede: { color: colors.textBody, fontSize: 14, lineHeight: 20 },
  /** `.section-kicker` on mobile — 10.5px. */
  kicker: {
    color: colors.text,
    fontSize: 10.5,
    letterSpacing: 1.5,
    fontWeight: '700',
    textTransform: 'uppercase' as const,
  },
  /** `.card-heading h2` — 18px / 1.2. */
  h2: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '600', letterSpacing: -0.4 },
  /** `.learning-title-line h3`, `.illness-record-title h3`. */
  h3: { color: colors.text, fontSize: 15.5, fontWeight: '600', letterSpacing: -0.2 },
  /** Card body copy. */
  body: { color: colors.textStrong, fontSize: 14, lineHeight: 20 },
  /** `.mobile-agenda-event > div span`, `.learning-copy > p`. */
  meta: { color: colors.textMuted, fontSize: 12.5, lineHeight: 17 },
  /** `.content-type` — tiny uppercase label. */
  label: {
    color: colors.textSoft,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '700',
    textTransform: 'uppercase' as const,
  },
  /** `.text-button` — 12.5px. */
  action: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
});

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  /** `.glass-card` as mobile renders it: #111111, slate border, 20px. */
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 18,
  },
  /** `.event-modal input` etc — 16px text so Android never zooms. */
  input: {
    minHeight: 50,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  /** `.primary-button` on mobile: 48px, white fill. */
  primaryButton: {
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  primaryLabel: { color: '#000000', fontSize: 15, fontWeight: '700' },
  /** `.secondary-button` on mobile. */
  ghostButton: {
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  ghostLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  /** Legacy aliases kept so older call sites keep compiling. */
  title: {
    color: colors.text,
    fontSize: 29,
    lineHeight: 32,
    fontWeight: '600',
    letterSpacing: -1.3,
  },
  muted: { color: colors.textBody, fontSize: 14, lineHeight: 20 },
  button: {
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  buttonLabel: { color: '#000000', fontSize: 15, fontWeight: '700' },
});

/* ------------------------------------------------------------------------ */
/* Color Mode                                                               */
/* ------------------------------------------------------------------------ */

const COLOR_MODE_KEY = 'mypro.colorMode';

interface ThemeState {
  colorMode: boolean;
  /** What `--deep`/`--accent` resolve to right now. */
  accent: string;
  /** A translucent accent wash for active fills. */
  accentSoft: string;
  /** The accent's border tint. */
  accentLine: string;
  setColorMode: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeState>({
  colorMode: false,
  accent: colors.text,
  accentSoft: 'rgba(255,255,255,0.1)',
  accentLine: 'rgba(255,255,255,0.22)',
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
      accentSoft: colorMode ? 'rgba(182,154,245,0.1)' : 'rgba(255,255,255,0.07)',
      accentLine: colorMode ? colors.violetLine : 'rgba(255,255,255,0.22)',
      setColorMode,
    }),
    [colorMode, setColorMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ThemeState => useContext(ThemeContext);
