import { describe, expect, it } from 'vitest';
import { findUnlinked } from '../src/mentions';
import { frontmatterEnd, splitLines } from '../src/reference';

// Every matcher case of the R5 round 3 probe (lanes/B5/review/probe-r5-round3.ts).
type C = { name: string; text: string; want: number; code?: boolean };
const cases: C[] = [
  { name: 'comment block over lines', text: '%%\nAtlas draft\n%%\nAtlas after', want: 1 },
  { name: 'comment opens mid line, closes later', text: 'Text %% hidden\nAtlas hidden\nend %% Atlas shown', want: 1 },
  { name: 'two comments on one line', text: '%% a %% Atlas %% b %% Atlas', want: 2 },
  { name: 'unclosed %% hides the rest (as Obsidian)', text: 'Atlas one\n%% start\nAtlas two', want: 1 },
  { name: 'inline code holds %%', text: 'Use `%%` to hide text.\nAtlas ships\nAtlas again', want: 2 },
  { name: 'inline code holds %% then real comment', text: 'Type `%%` here %% c %% Atlas', want: 1 },
  { name: 'fenced code holds %%', text: '```\n%%\n```\nAtlas ships', want: 1 },
  { name: 'comment holds a fence line', text: '%%\n```\n%%\nAtlas ships', want: 1 },
  { name: 'comment block with code blocks on', text: '%%\nAtlas\n%%\nAtlas', want: 1, code: true },
  // Kept as is (review round 3: not counted, rare): a %% here opens a comment block.
  { name: 'url with %% (encoded)', text: 'https://x.io/a%%b Atlas', want: 0 },
  // Kept as is (review round 3: not counted, rare): a %% here opens a comment block.
  { name: 'percent in wiki link alias', text: '[[Plan|50%%]] Atlas', want: 0 },
  { name: 'backtick fence with info', text: '```js\nAtlas\n```\nAtlas', want: 1 },
  { name: 'inline triple backticks top level', text: '```x``` here\nAtlas ships', want: 1 },
  { name: 'list inline triple backticks', text: '- ```x``` here\n- Atlas ships\n- Atlas again', want: 2 },
  { name: 'reference link defined', text: 'Read [Atlas][1].\n\n[1]: https://x.io', want: 0 },
  { name: 'reference link undefined', text: 'Read [x][Atlas] now', want: 1 },
  { name: 'shortcut ref defined', text: 'See [Atlas].\n\n[atlas]: https://x.io', want: 0 },
  { name: 'shortcut ref undefined', text: 'See [Atlas] now', want: 1 },
  { name: 'definition line with plain word', text: '[x]: Done.\nAtlas', want: 1 },
  { name: 'footnote with link', text: '[^1]: See https://x.io and Atlas.', want: 1 },
];

describe('R5 round 3 probe cases', () => {
	for (const c of cases) {
		it(c.name, () => {
			const lines = splitLines(c.text);
			const n = findUnlinked(lines, ['Atlas'], frontmatterEnd(lines), { codeBlocks: c.code === true }).reduce((s, h) => s + h.ranges.length, 0);
			expect(n).toBe(c.want);
		});
	}
});
