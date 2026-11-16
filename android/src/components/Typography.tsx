/**
 * DM Sans everywhere, which is what the web app loads from Google Fonts
 * (`@import … family=DM+Sans:wght@400;500;600;700` at the top of index.css).
 *
 * React Native has no font inheritance and no cascade: a `fontFamily` set on
 * a parent reaches nothing below it, so every single `<Text>` would otherwise
 * fall back to Roboto. Rather than repeat the family in several hundred style
 * objects, the app imports `Text` and `TextInput` from here instead of from
 * `react-native`, and this picks the right face from the weight already in
 * the style.
 *
 * Each weight is its own family on Android — there is no synthesis across
 * them — so the weight is resolved to a concrete file and then cleared, which
 * is what stops Android drawing a fake bold on top of an already-bold face.
 */
import { forwardRef } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInput as RNTextInputType,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

/**
 * The faces `@expo-google-fonts/dm-sans` ships. The family has no 600, which
 * the web does use for headings, so 600 resolves to Bold: a heading a shade
 * heavier than the browser's reads far closer than one a shade lighter.
 */
export const FONTS = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
} as const;

const BY_WEIGHT: Record<string, string> = {
  '100': FONTS.regular,
  '200': FONTS.regular,
  '300': FONTS.regular,
  '400': FONTS.regular,
  normal: FONTS.regular,
  '500': FONTS.medium,
  '600': FONTS.bold,
  '700': FONTS.bold,
  '800': FONTS.bold,
  '900': FONTS.bold,
  bold: FONTS.bold,
};

/** Resolve a style's weight to a concrete face, and clear the weight. */
function withFont(style: TextProps['style']): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const weight = flat.fontWeight === undefined ? '400' : String(flat.fontWeight);
  return {
    fontFamily: BY_WEIGHT[weight] ?? FONTS.regular,
    // Cleared on purpose: see the note at the top of the file.
    fontWeight: 'normal',
  };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  return <RNText ref={ref} {...rest} style={[style, withFont(style)]} />;
});

export const TextInput = forwardRef<RNTextInputType, TextInputProps>(function TextInput(
  { style, ...rest },
  ref,
) {
  return <RNTextInput ref={ref} {...rest} style={[style, withFont(style)]} />;
});
