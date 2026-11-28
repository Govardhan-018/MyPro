/**
 * Today's motivational quote.
 *
 * A fresh quote — and a fresh background — on every load, refresh and visit to
 * Today, never the same quote twice in a row: the last one shown is kept in
 * `sessionStorage` and excluded from the next draw.
 */
import { useState } from "react";
import { Quote as QuoteMark } from "lucide-react";
import { QUOTES, type Quote } from "../data/quotes";

/**
 * Dark mesh backgrounds: obsidian with one or two soft glows. Every one keeps
 * the centre of the card near-black so white text holds its contrast.
 * `accent` tints the kicker and the author line to match.
 */
export const QUOTE_BACKGROUNDS: { background: string; accent: string }[] = [
  {
    background:
      "radial-gradient(120% 90% at 0% 0%, rgba(182,154,245,0.30) 0%, transparent 55%), radial-gradient(90% 80% at 100% 100%, rgba(112,220,229,0.14) 0%, transparent 60%), #0b0a10",
    accent: "#c9b5fa",
  },
  {
    background:
      "radial-gradient(110% 90% at 100% 0%, rgba(131,217,176,0.26) 0%, transparent 58%), radial-gradient(80% 70% at 0% 100%, rgba(40,60,120,0.30) 0%, transparent 62%), #080c0b",
    accent: "#9fe3c2",
  },
  {
    background:
      "radial-gradient(120% 100% at 50% 0%, rgba(99,102,241,0.30) 0%, transparent 60%), radial-gradient(70% 60% at 100% 100%, rgba(182,154,245,0.16) 0%, transparent 65%), #09091a",
    accent: "#a5a8ff",
  },
  {
    background:
      "radial-gradient(110% 90% at 0% 100%, rgba(245,178,102,0.24) 0%, transparent 58%), radial-gradient(80% 70% at 100% 0%, rgba(120,60,40,0.26) 0%, transparent 62%), #0e0a07",
    accent: "#f4c48c",
  },
  {
    background:
      "radial-gradient(100% 90% at 100% 0%, rgba(113,183,245,0.26) 0%, transparent 58%), radial-gradient(90% 80% at 0% 100%, rgba(112,220,229,0.12) 0%, transparent 60%), #070b11",
    accent: "#9cccf7",
  },
  {
    background:
      "radial-gradient(120% 90% at 0% 0%, rgba(244,114,182,0.20) 0%, transparent 55%), radial-gradient(90% 80% at 100% 100%, rgba(99,102,241,0.20) 0%, transparent 62%), #0d0810",
    accent: "#f5a9cf",
  },
  {
    background:
      "radial-gradient(110% 100% at 50% 100%, rgba(112,220,229,0.22) 0%, transparent 60%), radial-gradient(70% 60% at 0% 0%, rgba(131,217,176,0.14) 0%, transparent 65%), #060c0d",
    accent: "#8fe6ec",
  },
  {
    background:
      "radial-gradient(100% 80% at 100% 100%, rgba(212,236,104,0.18) 0%, transparent 58%), radial-gradient(90% 80% at 0% 0%, rgba(182,154,245,0.16) 0%, transparent 60%), #0b0c08",
    accent: "#dcef8a",
  },
  {
    background:
      "linear-gradient(155deg, rgba(182,154,245,0.20) 0%, transparent 42%), radial-gradient(80% 70% at 100% 100%, rgba(245,178,102,0.16) 0%, transparent 62%), #0c0a0d",
    accent: "#d7c4fb",
  },
  {
    background:
      "radial-gradient(130% 100% at 0% 50%, rgba(40,52,90,0.55) 0%, transparent 60%), radial-gradient(70% 60% at 100% 0%, rgba(113,183,245,0.18) 0%, transparent 62%), #07080c",
    accent: "#b4c4ee",
  },
];

const LAST_QUOTE_KEY = "mypro.quote.last";
const LAST_BG_KEY = "mypro.quote.bg";

/**
 * A random index in `[0, length)` that is not `exclude` (when there is any
 * other choice). Pure apart from `random`, so it is tested directly.
 */
export function pickIndex(length: number, exclude: number, random: () => number = Math.random): number {
  if (length <= 1) return 0;
  const usable = exclude >= 0 && exclude < length;
  const n = Math.floor(random() * (usable ? length - 1 : length));
  return usable && n >= exclude ? n + 1 : n;
}

/** The next quote: random, never the one with `lastId`. */
export function pickQuote(quotes: Quote[], lastId: string | null, random: () => number = Math.random): Quote | null {
  if (!quotes.length) return null;
  const exclude = lastId ? quotes.findIndex((q) => q.id === lastId) : -1;
  return quotes[pickIndex(quotes.length, exclude, random)];
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked — repeats become merely unlikely */
  }
}

/** Draw once per mount, remembering the draw so the next one differs. */
function draw(): { quote: Quote | null; bg: number } {
  const quote = pickQuote(QUOTES, readSession(LAST_QUOTE_KEY));
  const bg = pickIndex(QUOTE_BACKGROUNDS.length, Number(readSession(LAST_BG_KEY) ?? -1));
  if (quote) writeSession(LAST_QUOTE_KEY, quote.id);
  writeSession(LAST_BG_KEY, String(bg));
  return { quote, bg };
}

export function QuoteCard() {
  // Lazy initial state: one draw per mount, stable across re-renders.
  const [{ quote, bg }] = useState(draw);
  if (!quote) return null;
  const look = QUOTE_BACKGROUNDS[bg];
  return (
    <figure
      className="glass-card quote-card"
      style={{ background: look.background, ["--quote-accent" as string]: look.accent }}
    >
      <span className="quote-kicker">
        <QuoteMark size={14} aria-hidden="true" /> TODAY’S QUOTE
      </span>
      <blockquote>
        <p>{quote.text}</p>
      </blockquote>
      <figcaption>— {quote.author}</figcaption>
    </figure>
  );
}
