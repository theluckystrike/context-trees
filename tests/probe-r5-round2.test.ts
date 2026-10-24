import { describe, expect, it } from 'vitest';
import { findUnlinked } from '../src/mentions';
import { frontmatterEnd, splitLines } from '../src/reference';

// Every matcher case of the R5 round 2 probe (lanes/B5/review/probe-r5-round2.ts).
type C = { name: string; text: string; want: number; names?: string[]; code?: boolean };
const cases: C[] = [
  { name: 'footnote definition prose', text: 'Text[^1]\n\n[^1]: Atlas launched in 2024.', want: 1 },
  { name: 'footnote definition, indented continuation', text: '[^1]: Source.\n    Atlas was renamed.', want: 1 },
  { name: 'reference definition line', text: '[1]: https://x.io/atlas "Atlas"', want: 0 },
  { name: 'glossary-like line with colon', text: '[Draft]: Atlas needs review', want: 1 },
  { name: 'money two prices', text: 'Atlas costs $5 and Beta costs $10', want: 1 },
  { name: 'money no space before second $', text: 'Prices $5 for Atlas,$10 for Pro', want: 1 },
  { name: 'money range', text: 'Atlas $5-$10 range', want: 1 },
  { name: 'real inline math', text: 'where $x_{Atlas}$ is', want: 0 },
  { name: 'comment then mention', text: '%% todo %% Atlas ships', want: 1 },
  // Obsidian reads the text between two %% as a comment (review round 2 accepts 0).
  { name: 'percent signs', text: 'Growth 50%% then Atlas 20%%', want: 0 },
  { name: 'html link then mention', text: '<a href="x">site</a> Atlas', want: 1 },
  { name: 'abbr tag', text: '<abbr>Atlas</abbr>', want: 1 },
  { name: 'task box then bracket', text: '- [ ] [Atlas] review', want: 1 },
  { name: 'two bracket groups (checkbox style)', text: '- [x][Atlas] review', want: 1 },
  { name: 'callout title', text: '> [!note] Atlas update\n> Atlas text', want: 2 },
  { name: 'list item triple-backtick inline code', text: '- ```x``` here\n- Atlas ships\n- Atlas again', want: 2 },
  { name: 'top-level triple-backtick inline (pre-existing)', text: '```x``` here\nAtlas ships', want: 1 },
  { name: 'tab-indented list paragraph after blank', text: '- item\n\n\tAtlas continues the item', want: 1 },
  { name: 'paragraph after list, then indented', text: '- item\n\nPara\n\n    Atlas code', want: 0 },
  { name: 'nested list with tabs', text: '- a\n\t- Atlas nested\n\t\t- Atlas deeper', want: 2 },
  { name: 'nested list after blank line', text: '- a\n\n\t- Atlas nested', want: 1 },
  { name: 'ordered list paragraph', text: '1. step\n\n    Atlas detail', want: 1 },
  { name: 'heading then tab paragraph', text: '# H\n\n\tAtlas', want: 0 },
  { name: 'blockquote with 4-space after >', text: '> quote\n>\n>     Atlas', want: 0 },
  { name: 'fence in callout closes', text: '> ```\n> code\n> ```\n> Atlas after', want: 1 },
  { name: 'list fence then text', text: '- a\n\t```\n\tcode\n\t```\n- Atlas', want: 1 },
  { name: 'code blocks on: list fence content counts', text: '- a\n\t```\n\tAtlas\n\t```', want: 1, code: true },
  { name: 'CJK name in longer word (accepted change)', text: '东京都', want: 1, names: ['东京'] },
  { name: 'mixed Latin+Han name boundary', text: 'XAtlas东京', want: 0, names: ['Atlas东京'] },
];

describe('R5 round 2 probe cases', () => {
	for (const c of cases) {
		it(c.name, () => {
			const lines = splitLines(c.text);
			const n = findUnlinked(lines, c.names ?? ['Atlas'], frontmatterEnd(lines), { codeBlocks: c.code === true }).reduce((s, h) => s + h.ranges.length, 0);
			expect(n).toBe(c.want);
		});
	}
});
