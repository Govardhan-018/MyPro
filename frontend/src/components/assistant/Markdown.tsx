/**
 * Markdown for assistant replies — headings, paragraphs, lists (nested),
 * tables, block quotes, rules, fenced code with a copy button, and inline
 * bold / italic / strike / code / links.
 *
 * Built as React elements, never `innerHTML`: a reply is model output that may
 * quote web pages, so nothing in it can become markup or script. Links are
 * limited to http(s) and mailto and open in a new tab.
 *
 * The parser is pure (`parseMarkdown`) and unit-tested; rendering is memoised
 * per text so a long conversation does not re-parse on every keystroke.
 */
import { memo, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export type MdInline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: MdInline[] }
  | { t: "em"; c: MdInline[] }
  | { t: "del"; c: MdInline[] }
  | { t: "link"; href: string; c: MdInline[] }
  | { t: "br" };

export interface MdListItem {
  content: MdInline[];
  children: MdBlock[];
  checked?: boolean;
}

export type MdBlock =
  | { t: "h"; level: number; c: MdInline[] }
  | { t: "p"; c: MdInline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: MdBlock[] }
  | { t: "list"; ordered: boolean; start: number; items: MdListItem[] }
  | { t: "table"; head: MdInline[][]; align: ("left" | "center" | "right" | null)[]; rows: MdInline[][][] }
  | { t: "hr" };

/* ------------------------------------------------------------------ */
/* inline                                                               */
/* ------------------------------------------------------------------ */

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];

    if (ch === "\\" && i + 1 < src.length && /[\\`*_~[\]()#>|-]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i += 1;
      continue;
    }
    if (ch === "`") {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
      if (m) {
        flush();
        out.push({ t: "code", v: m[2].replace(/^ (.*) $/, "$1") });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
      if (m) {
        flush();
        const href = m[2];
        if (SAFE_HREF.test(href)) out.push({ t: "link", href, c: parseInline(m[1]) });
        else out.push(...parseInline(m[1]));
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const m = ch === "*" ? /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest) : /^__(?=\S)([\s\S]*?\S)__(?!\w)/.exec(rest);
      if (m) {
        flush();
        out.push({ t: "strong", c: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "~" && src[i + 1] === "~") {
      const m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest);
      if (m) {
        flush();
        out.push({ t: "del", c: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      // `_` only at a word boundary, so snake_case stays text.
      const prevWord = i > 0 && /\w/.test(src[i - 1]);
      const m =
        ch === "*" ? /^\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/.exec(rest) : prevWord ? null : /^_(?=\S)([^_\n]*?\S)_(?!\w)/.exec(rest);
      if (m) {
        flush();
        out.push({ t: "em", c: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "h" || ch === "w") {
      const m = /^(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.exec(rest);
      if (m && (i === 0 || /[\s(]/.test(src[i - 1]))) {
        flush();
        out.push({ t: "link", href: m[1], c: [{ t: "text", v: m[1] }] });
        i += m[1].length;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* blocks                                                               */
/* ------------------------------------------------------------------ */

const FENCE = /^(\s*)(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const indentOf = (line: string) => line.replace(/\t/g, "    ").match(/^ */)![0].length;
const isBlank = (line: string) => line.trim() === "";

function startsBlock(line: string, next?: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    LIST_ITEM.test(line) ||
    QUOTE.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next) && next.includes("-"))
  );
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  return parseLines(lines);
}

function parseLines(lines: string[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or end of a reply cut off mid-block)
      blocks.push({ t: "code", lang: fence[3], v: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: "h", level: heading[1].length, c: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (!isBlank(lines[i]) && !startsBlock(lines[i])))) {
        const m = QUOTE.exec(lines[i]);
        inner.push(m ? m[1] : lines[i]);
        i += 1;
      }
      blocks.push({ t: "quote", c: parseLines(inner) });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : null,
      );
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, c) => parseInline(cells[c] ?? "")));
        i += 1;
      }
      blocks.push({ t: "table", head: head.map(parseInline), align, rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const baseIndent = indentOf(line);
      const ordered = /\d/.test(item[2]);
      const list: MdBlock & { t: "list" } = {
        t: "list",
        ordered,
        start: ordered ? parseInt(item[2], 10) : 1,
        items: [],
      };
      while (i < lines.length) {
        const current = LIST_ITEM.exec(lines[i]);
        if (!current || indentOf(lines[i]) !== baseIndent || /\d/.test(current[2]) !== ordered) break;
        let text = current[3];
        let checked: boolean | undefined;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
        if (task) {
          checked = task[1].toLowerCase() === "x";
          text = task[2];
        }
        const textLines = [text];
        const childLines: string[] = [];
        i += 1;
        // Continuation lines and nested blocks: anything indented deeper.
        while (i < lines.length) {
          const next = lines[i];
          if (isBlank(next)) {
            const after = lines[i + 1];
            if (after !== undefined && !isBlank(after) && indentOf(after) > baseIndent) {
              childLines.push("");
              i += 1;
              continue;
            }
            break;
          }
          if (indentOf(next) > baseIndent) {
            if (!childLines.length && !LIST_ITEM.test(next) && !FENCE.test(next)) textLines.push(next.trim());
            else childLines.push(next.slice(Math.min(indentOf(next), baseIndent + 2)));
            i += 1;
            continue;
          }
          if (!LIST_ITEM.test(next) && !startsBlock(next, lines[i + 1]) && indentOf(next) >= baseIndent && !childLines.length) {
            textLines.push(next.trim()); // lazy continuation
            i += 1;
            continue;
          }
          break;
        }
        list.items.push({
          content: parseInline(textLines.join("\n")),
          children: childLines.length ? parseLines(childLines) : [],
          checked,
        });
      }
      blocks.push(list);
      continue;
    }

    // Paragraph: until a blank line or the start of another block.
    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}

/* ------------------------------------------------------------------ */
/* rendering                                                            */
/* ------------------------------------------------------------------ */

function renderInline(nodes: MdInline[], key = "i"): ReactNode[] {
  return nodes.map((node, index) => {
    const k = `${key}.${index}`;
    switch (node.t) {
      case "text":
        return node.v;
      case "br":
        return <br key={k} />;
      case "code":
        return <code key={k}>{node.v}</code>;
      case "strong":
        return <strong key={k}>{renderInline(node.c, k)}</strong>;
      case "em":
        return <em key={k}>{renderInline(node.c, k)}</em>;
      case "del":
        return <del key={k}>{renderInline(node.c, k)}</del>;
      case "link":
        return (
          <a key={k} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.c, k)}
          </a>
        );
    }
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API refused (insecure context, WebView): the old way.
      const area = document.createElement("textarea");
      area.value = code;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || "code"}</span>
        <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy code"}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderBlocks(blocks: MdBlock[], key = "b"): ReactNode[] {
  return blocks.map((block, index) => {
    const k = `${key}.${index}`;
    switch (block.t) {
      case "h": {
        const Tag = (`h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6");
        return <Tag key={k}>{renderInline(block.c, k)}</Tag>;
      }
      case "p":
        return <p key={k}>{renderInline(block.c, k)}</p>;
      case "code":
        return <CodeBlock key={k} lang={block.lang} code={block.v} />;
      case "hr":
        return <hr key={k} />;
      case "quote":
        return <blockquote key={k}>{renderBlocks(block.c, k)}</blockquote>;
      case "list": {
        const items = block.items.map((item, n) => (
          <li key={`${k}.${n}`} className={item.checked === undefined ? undefined : "md-task"}>
            {item.checked !== undefined && (
              <input type="checkbox" checked={item.checked} readOnly disabled aria-label={item.checked ? "Done" : "Not done"} />
            )}
            {renderInline(item.content, `${k}.${n}`)}
            {item.children.length > 0 && renderBlocks(item.children, `${k}.${n}c`)}
          </li>
        ));
        return block.ordered ? (
          <ol key={k} start={block.start !== 1 ? block.start : undefined}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
      case "table":
        return (
          <div key={k} className="md-table" role="region" aria-label="Table" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, c) => (
                    <th key={c} style={block.align[c] ? { textAlign: block.align[c]! } : undefined}>
                      {renderInline(cell, `${k}h${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} style={block.align[c] ? { textAlign: block.align[c]! } : undefined}>
                        {renderInline(cell, `${k}r${r}c${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** A reply, rendered. Memoised: the same text never re-parses. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{renderBlocks(blocks)}</div>;
});
