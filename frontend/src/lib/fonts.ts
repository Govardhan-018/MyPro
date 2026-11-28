/**
 * The app's typefaces, bundled rather than fetched from Google Fonts.
 *
 * Bundled so they work offline (the service worker precaches every built
 * asset, and the Android app is often opened without a connection) and so no
 * third party sees each page load. Only the Latin subsets are imported — the
 * packages ship Cyrillic, Greek and Vietnamese too, and every file imported
 * here is downloaded by the offline precache, so each one has to earn it.
 *
 * Roles (see `--font-*` in index.css):
 *   Outfit          body, descriptions, controls
 *   Space Grotesk   headings and titles
 *   JetBrains Mono  numbers, times, dates, labels and kickers
 *   Changa One      display moments (greeting, welcome)
 *   Black Ops One   hero numerals (the progress gauge)
 * Reader-only choices: Literata, Lora, Atkinson Hyperlegible (plus the above).
 */
import outfitLatin from "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url";
import outfitLatinExt from "@fontsource-variable/outfit/files/outfit-latin-ext-wght-normal.woff2?url";
import groteskLatin from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url";
import groteskLatinExt from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-ext-wght-normal.woff2?url";
import monoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
import monoLatinItalic from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2?url";
import changaLatin from "@fontsource/changa-one/files/changa-one-latin-400-normal.woff2?url";
import blackOpsLatin from "@fontsource/black-ops-one/files/black-ops-one-latin-400-normal.woff2?url";
import literataLatin from "@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url";
import literataLatinItalic from "@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url";
import loraLatin from "@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url";
import loraLatinItalic from "@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url";
import atkinson400 from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url";
import atkinson400Italic from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2?url";
import atkinson700 from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url";

/** Latin + Latin-1 + common punctuation. */
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

interface Face {
  family: string;
  url: string;
  /** "400" or a variable range like "100 900". */
  weight: string;
  style?: "normal" | "italic";
  range?: string;
  variable?: boolean;
}

const FACES: Face[] = [
  { family: "Outfit", url: outfitLatin, weight: "100 900", range: LATIN, variable: true },
  { family: "Outfit", url: outfitLatinExt, weight: "100 900", range: LATIN_EXT, variable: true },
  { family: "Space Grotesk", url: groteskLatin, weight: "300 700", range: LATIN, variable: true },
  { family: "Space Grotesk", url: groteskLatinExt, weight: "300 700", range: LATIN_EXT, variable: true },
  { family: "JetBrains Mono", url: monoLatin, weight: "100 800", range: LATIN, variable: true },
  { family: "JetBrains Mono", url: monoLatinItalic, weight: "100 800", style: "italic", range: LATIN, variable: true },
  { family: "Changa One", url: changaLatin, weight: "400", range: LATIN },
  { family: "Black Ops One", url: blackOpsLatin, weight: "400", range: LATIN },
  { family: "Literata", url: literataLatin, weight: "200 900", range: LATIN, variable: true },
  { family: "Literata", url: literataLatinItalic, weight: "200 900", style: "italic", range: LATIN, variable: true },
  { family: "Lora", url: loraLatin, weight: "400 700", range: LATIN, variable: true },
  { family: "Lora", url: loraLatinItalic, weight: "400 700", style: "italic", range: LATIN, variable: true },
  { family: "Atkinson Hyperlegible", url: atkinson400, weight: "400", range: LATIN },
  { family: "Atkinson Hyperlegible", url: atkinson400Italic, weight: "400", style: "italic", range: LATIN },
  { family: "Atkinson Hyperlegible", url: atkinson700, weight: "700", range: LATIN },
];

export function fontFaceCss(faces: Face[] = FACES): string {
  return faces
    .map(
      (f) => `@font-face {
  font-family: "${f.family}";
  font-style: ${f.style ?? "normal"};
  font-weight: ${f.weight};
  font-display: swap;
  src: url("${f.url}") format("${f.variable ? "woff2-variations" : "woff2"}"), url("${f.url}") format("woff2");
  ${f.range ? `unicode-range: ${f.range};` : ""}
}`,
    )
    .join("\n");
}

/** Register the faces once, before the first render. */
export function installFonts(): void {
  if (typeof document === "undefined" || document.getElementById("mypro-fonts")) return;
  const style = document.createElement("style");
  style.id = "mypro-fonts";
  style.textContent = fontFaceCss();
  document.head.appendChild(style);
}

/** The reader's typeface choices. `stack` is what the page is set in. */
export const READER_FONTS = [
  { id: "literata", label: "Literata", hint: "Book serif", stack: '"Literata", Georgia, serif' },
  { id: "lora", label: "Lora", hint: "Classic serif", stack: '"Lora", Georgia, serif' },
  { id: "outfit", label: "Outfit", hint: "Clean sans", stack: '"Outfit", system-ui, sans-serif' },
  {
    id: "atkinson",
    label: "Atkinson",
    hint: "Most legible",
    stack: '"Atkinson Hyperlegible", system-ui, sans-serif',
  },
  { id: "grotesk", label: "Grotesk", hint: "Geometric", stack: '"Space Grotesk", system-ui, sans-serif' },
  { id: "mono", label: "Mono", hint: "Typewriter", stack: '"JetBrains Mono", ui-monospace, monospace' },
] as const;

export type ReaderFontId = (typeof READER_FONTS)[number]["id"];
export const DEFAULT_READER_FONT: ReaderFontId = "literata";

export function readerFontStack(id: string): string {
  return (READER_FONTS.find((f) => f.id === id) ?? READER_FONTS[0]).stack;
}
