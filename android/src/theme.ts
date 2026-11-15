import { StyleSheet } from 'react-native';

/**
 * The app's shared surface tokens — the same design language as the web app:
 * pure black, graphite cards, white type with size-based hierarchy, and thin
 * translucent borders.
 */
export const colors = {
  background: '#000000',
  surface: '#0e0e0e',
  border: 'rgba(255,255,255,0.1)',
  text: '#ffffff',
  textStrong: 'rgba(255,255,255,0.85)',
  textMuted: 'rgba(255,255,255,0.5)',
  textFaint: 'rgba(255,255,255,0.35)',
};

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.text,
  },
  buttonLabel: { color: colors.background, fontSize: 15, fontWeight: '600' },
  ghostButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  ghostLabel: { color: colors.textStrong, fontSize: 14 },
});
