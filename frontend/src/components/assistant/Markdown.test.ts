import { describe, it, expect } from 'vitest';
import { parseInline, parseMarkdown } from './Markdown';

/**
 * Replies used to be printed as plain text, so "**What happened**" and
 * "- item" showed up raw. These pin the parser the chat now renders through.
 */
describe('parseMarkdown', () => {
  it('turns the reply from the bug report into a heading-ish bold line and a real list', () => {
    const blocks = parseMarkdown(
      '**What happened**\n- **s1 (Weather)** – **FAILED**. Every provider returned 429.\n- **s2 (Ronaldo)** – **DONE**.',
    );
    expect(blocks[0]).toMatchObject({ t: 'p', c: [{ t: 'strong' }] });
    expect(blocks[1]).toMatchObject({ t: 'list', ordered: false });
    const list = blocks[1] as Extract<(typeof blocks)[number], { t: 'list' }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0].content[0]).toMatchObject({ t: 'strong' });
  });

  it('headings, ordered lists with a start, rules and quotes', () => {
    const blocks = parseMarkdown('## Plan\n\n3. three\n4. four\n\n---\n\n> quoted\n> more');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'list', 'hr', 'quote']);
    expect(blocks[0]).toMatchObject({ level: 2 });
    expect(blocks[1]).toMatchObject({ ordered: true, start: 3 });
  });

  it('nested lists keep their structure', () => {
    const [list] = parseMarkdown('- parent\n  - child one\n  - child two\n- sibling');
    expect(list).toMatchObject({ t: 'list' });
    const l = list as Extract<typeof list, { t: 'list' }>;
    expect(l.items).toHaveLength(2);
    expect(l.items[0].children[0]).toMatchObject({ t: 'list' });
  });

  it('fenced code keeps its text verbatim, including markdown-looking lines', () => {
    const [code] = parseMarkdown('```ts\nconst a = **b**;\n# not a heading\n```');
    expect(code).toEqual({ t: 'code', lang: 'ts', v: 'const a = **b**;\n# not a heading' });
  });

  it('an unterminated fence (reply cut off) still renders as code', () => {
    const [code] = parseMarkdown('```\nhalf');
    expect(code).toMatchObject({ t: 'code', v: 'half' });
  });

  it('tables with alignment', () => {
    const [table] = parseMarkdown('| Team | Date |\n|:--|--:|\n| IND | 26 Nov |\n| NZ | 27 Nov |');
    expect(table).toMatchObject({ t: 'table', align: ['left', 'right'] });
    expect((table as Extract<typeof table, { t: 'table' }>).rows).toHaveLength(2);
  });

  it('single newlines inside a paragraph are line breaks, blank lines split paragraphs', () => {
    const blocks = parseMarkdown('line one\nline two\n\nnext');
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as { c: { t: string }[] }).c.some((n) => n.t === 'br')).toBe(true);
  });
});

describe('parseInline', () => {
  it('bold, italic, strike, code and links', () => {
    expect(parseInline('**b** *i* ~~s~~ `c` [l](https://x.dev)').map((n) => n.t)).toEqual([
      'strong', 'text', 'em', 'text', 'del', 'text', 'code', 'text', 'link',
    ]);
  });

  it('never produces a link to javascript: or other unsafe schemes', () => {
    const nodes = parseInline('[click](javascript:alert(1))');
    expect(nodes.some((n) => n.t === 'link')).toBe(false);
  });

  it('leaves snake_case and lone asterisks alone', () => {
    expect(parseInline('use snake_case_name and 2 * 3')).toEqual([
      { t: 'text', v: 'use snake_case_name and 2 * 3' },
    ]);
  });

  it('autolinks bare URLs without swallowing trailing punctuation', () => {
    const nodes = parseInline('See https://example.com/a.');
    expect(nodes[1]).toMatchObject({ t: 'link', href: 'https://example.com/a' });
    expect(nodes[2]).toEqual({ t: 'text', v: '.' });
  });
});
