import { describe, expect, it } from 'vitest';
import { findUnlinked } from '../src/mentions';
import { frontmatterEnd, splitLines } from '../src/reference';

// Every case of the R5 review probe (lanes/B5/review/probe-r5.ts). Cases where 1.4.0 decides differently from the probe:
// - tag after paren: decided: "(#atlas)" is text, a tag needs a line start or white space before #
// - url no scheme: decided: an address needs a scheme or www.
// - turkish dotted I: known limit: İ changes length in lower case, so the match keeps case
// - german sharp s: known limit: no full case folding (ß and SS)
// - ignore astral boundary: correct: Atlas after a letter is not a whole word

type Case = { name: string; text: string; names: string[]; want: number; rules?: { codeBlocks?: boolean; ignore?: string[] } };
const cases: Case[] = [
	// Links with aliases, embeds
	{ name: 'wiki link with alias', text: 'See [[Atlas|the plan]] and [[Other|Atlas]].', names: ['Atlas'], want: 0 },
	{ name: 'embed with heading', text: '![[Atlas#Goals]] here', names: ['Atlas'], want: 0 },
	{ name: 'plain mention counts', text: 'Atlas ships soon', names: ['Atlas'], want: 1 },
	// Nested brackets
	{ name: 'md link label with nested brackets', text: 'Read [the [Atlas] plan](notes.md) now', names: ['Atlas'], want: 0 },
	{ name: 'md link dest relative with name', text: 'Read [the plan](Atlas.md) now', names: ['Atlas'], want: 0 },
	{ name: 'md link single-quoted title', text: "Read [Atlas](notes.md 'title') now", names: ['Atlas'], want: 0 },
	{ name: 'reference-style link label', text: 'Read [Atlas][1] now\n\n[1]: https://x.io', names: ['Atlas'], want: 0 },
	{ name: 'md link label holds wiki link', text: 'x [see [[Atlas]]](https://x.io) y', names: ['Atlas'], want: 0 },
	// Tags with slashes
	{ name: 'tag with slash', text: 'Tagged #project/atlas today', names: ['atlas'], want: 0 },
	{ name: 'tag after paren', text: 'Tagged (#atlas) today', names: ['atlas'], want: 1 },
	{ name: 'tag with non-latin', text: 'Tagged #проект/атлас today', names: ['атлас'], want: 0 },
	// Inline code with backticks
	{ name: 'double backtick code with inner tick', text: 'Use ``Atlas ` x`` now', names: ['Atlas'], want: 0 },
	{ name: 'unclosed long run then code', text: 'a `` b `Atlas` c', names: ['Atlas'], want: 0 },
	// Fenced code with tildes
	{ name: 'tilde fence', text: '~~~atlas\nAtlas inside\n~~~\nAtlas out', names: ['Atlas'], want: 1 },
	{ name: 'tilde fence closed by backticks is not closed', text: '~~~\nAtlas\n```\nAtlas\n~~~\nAtlas', names: ['Atlas'], want: 1 },
	{ name: 'fence in callout', text: '> [!note]\n> ```\n> Atlas in code\n> ```\nend', names: ['Atlas'], want: 0 },
	{ name: 'fence in list item (4 spaces)', text: '- item\n    ```\n    Atlas in code\n    ```\n- next', names: ['Atlas'], want: 0 },
	{ name: 'fence in list item (tab)', text: '- item\n\t```\n\tAtlas in code\n\t```\n- next', names: ['Atlas'], want: 0 },
	// Front matter
	{ name: 'front matter', text: '---\ntitle: Atlas\n---\nbody', names: ['Atlas'], want: 0 },
	{ name: 'front matter CRLF', text: '---\r\ntitle: Atlas\r\n---\r\nbody', names: ['Atlas'], want: 0 },
	// URLs with parentheses
	{ name: 'bare url with parens', text: 'See https://en.wikipedia.org/wiki/Atlas_(mythology) ok', names: ['Atlas'], want: 0 },
	{ name: 'md link url with parens', text: 'See [wiki](https://en.wikipedia.org/wiki/Atlas_(mythology)) ok', names: ['Atlas'], want: 0 },
	{ name: 'url in parens then mention', text: '(see https://x.io/a) Atlas', names: ['Atlas'], want: 1 },
	{ name: 'url no scheme', text: 'see example.com/atlas now', names: ['atlas'], want: 1 },
	{ name: 'obsidian uri', text: 'obsidian://open?vault=v&file=Atlas', names: ['Atlas'], want: 0 },
	// Case and word boundaries, non-Latin
	{ name: 'cyrillic case', text: 'АТЛАС готов', names: ['Атлас'], want: 1 },
	{ name: 'cyrillic inside word', text: 'атласный', names: ['Атлас'], want: 0 },
	{ name: 'CJK in sentence', text: '我们明天去东京开会', names: ['东京'], want: 1 },
	{ name: 'CJK with spaces', text: '我们 东京 开会', names: ['东京'], want: 1 },
	{ name: 'japanese with particle', text: '私は東京に行く', names: ['東京'], want: 1 },
	{ name: 'turkish dotted I', text: 'İSTANBUL trip', names: ['istanbul'], want: 0 },
	{ name: 'german sharp s', text: 'STRASSE', names: ['Straße'], want: 0 },
	{ name: 'accented boundary', text: 'Atlasé', names: ['Atlas'], want: 0 },
	{ name: 'combining mark after', text: 'Atlasé', names: ['Atlas'], want: 0 },
	// Ignored terms
	{ name: 'ignore phrase', text: 'Atlas Copco makes tools. Atlas ships.', names: ['Atlas'], want: 1, rules: { ignore: ['atlas copco'] } },
	{ name: 'ignore term partial word not hit', text: 'Atlas Copcos', names: ['Atlas'], want: 1, rules: { ignore: ['Atlas Copco'] } },
	{ name: 'ignore CJK term', text: '东京都 东京', names: ['东京'], want: 1, rules: { ignore: ['东京都'] } },
	{ name: 'ignore astral boundary', text: '𝐀Atlas Copco', names: ['Atlas'], want: 0, rules: { ignore: ['Atlas Copco'] } },
	// Escape
	{ name: 'escaped wiki', text: '\\[[Atlas]] text', names: ['Atlas'], want: 1 },
	// Comments, math (not in spec, informational)
	{ name: 'obsidian comment', text: '%% Atlas %%', names: ['Atlas'], want: 0 },
	{ name: 'inline math', text: '$Atlas$', names: ['Atlas'], want: 0 },
	{ name: 'html link', text: '<a href="x">Atlas</a>', names: ['Atlas'], want: 0 },
	{ name: 'footnote ref', text: 'text[^Atlas]', names: ['Atlas'], want: 0 },
	{ name: 'indented code block', text: 'para\n\n    Atlas code\n\npara', names: ['Atlas'], want: 0 },
];

describe('R5 review probe cases', () => {
	for (const c of cases) {
		it(c.name, () => {
			const lines = splitLines(c.text);
			const hits = findUnlinked(lines, c.names, frontmatterEnd(lines), c.rules ?? {});
			expect(hits.reduce((s, h) => s + h.ranges.length, 0)).toBe(c.want);
		});
	}
});
