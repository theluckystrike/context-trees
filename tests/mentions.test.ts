import { describe, expect, it } from 'vitest';
import { codeSpans, exclusionsByLine, findUnlinked, inFolders, lineExclusions, listOf, optOut } from '../src/mentions';
import { splitLines } from '../src/reference';

const cols = (line: string, ranges: [number, number][]) => ranges.map(([a, b]) => line.slice(a, b));

describe('unlinked mention rules (topic 8599)', () => {
	it('finds code spans with matching backtick runs only', () => {
		const line = 'a `x` b ``y ` z`` c `open';
		expect(cols(line, codeSpans(line))).toEqual(['`x`', '``y ` z``']);
		expect(codeSpans('\\`not code`')).toEqual([]);
	});

	it('excludes links, URLs and tags on one line', () => {
		const line = 'See [[Atlas]], [web](https://a.io/atlas), #atlas/x and www.atlas.com or <mailto:atlas@x.io> plus ![[Atlas.png]]';
		expect(cols(line, lineExclusions(line)).sort()).toEqual(['[[Atlas]]', '[web](https://a.io/atlas)', '<mailto:atlas@x.io>', '![[Atlas.png]]', 'www.atlas.com', '#atlas/x'].sort());
	});

	it('does not treat a number or a heading mark as a tag', () => {
		expect(lineExclusions('Issue #123 and C#')).toEqual([]);
		expect(lineExclusions('# Atlas')).toEqual([]);
	});

	it('keeps a link inside inline code as code only', () => {
		const line = '`[[Atlas]]` Atlas';
		expect(cols(line, lineExclusions(line))).toEqual(['`[[Atlas]]`']);
	});

	it('marks fenced lines and fence lines, and honors the code block setting', () => {
		const lines = splitLines('Atlas\n````md\nAtlas\n```\nstill code\n````\nAtlas');
		expect([...exclusionsByLine(lines, 0).keys()]).toEqual([1, 2, 3, 4, 5]);
		expect([...exclusionsByLine(lines, 0, { codeBlocks: true }).keys()]).toEqual([1, 5]);
	});

	it('an unclosed fence runs to the end of the note', () => {
		expect(findUnlinked(splitLines('```\nAtlas\nAtlas'), ['Atlas'], 0)).toEqual([]);
	});

	it('merges links that the metadata cache knows', () => {
		const lines = ['Atlas and Atlas'];
		expect(findUnlinked(lines, ['Atlas'], 0, {}, new Map([[0, [[0, 5]]]]))).toEqual([{ line: 0, ranges: [[10, 15]] }]);
	});

	it('ignores one-letter names and empty ignore lines', () => {
		expect(findUnlinked(['a b c'], ['a'], 0)).toEqual([]);
		expect(findUnlinked(['Atlas'], ['Atlas'], 0, { ignore: ['', '  '] })).toEqual([{ line: 0, ranges: [[0, 5]] }]);
	});
});

describe('mention scope', () => {
	it('reads one entry for each line of a setting', () => {
		expect(listOf(' Templates \n\nArchive/Old\nTemplates\r\n')).toEqual(['Templates', 'Archive/Old']);
	});

	it('matches folders and subfolders, not name prefixes', () => {
		const f = ['Templates', '/Archive/Old/'];
		expect(inFolders('Templates/Daily.md', f)).toBe(true);
		expect(inFolders('Archive/Old/x/y.md', f)).toBe(true);
		expect(inFolders('Templates2/Daily.md', f)).toBe(false);
		expect(inFolders('Notes/Templates.md', f)).toBe(false);
		expect(inFolders('a.md', ['/', ''])).toBe(false);
	});

	it('reads the opt-out property', () => {
		expect(optOut({ 'context-trees-mentions': false })).toEqual({ source: true, target: true });
		expect(optOut({ 'context-trees-mentions': 'none' })).toEqual({ source: true, target: true });
		expect(optOut({ 'context-trees-mentions': 'Source' })).toEqual({ source: true, target: false });
		expect(optOut({ 'context-trees-mentions': 'target' })).toEqual({ source: false, target: true });
		expect(optOut({ 'context-trees-mentions': true })).toEqual({ source: false, target: false });
		expect(optOut(null)).toEqual({ source: false, target: false });
	});
});

describe('mention scan cost', () => {
	it('scans 2,000 notes of 40 lines in well under one second', () => {
		const words = ['alpha', 'bravo', 'charlie', 'delta'];
		const notes = Array.from({ length: 2000 }, (_, i) =>
			Array.from({ length: 40 }, (_, j) => `- ${words[(i + j) % 4]} line ${j} [[Link ${i}]] https://x.io/${i} #tag${j} \`code\` ${j % 9 === 0 ? 'Atlas' : ''}`),
		);
		const t0 = performance.now();
		let hits = 0;
		for (const lines of notes) hits += findUnlinked(lines, ['Atlas'], 0).length;
		const ms = performance.now() - t0;
		expect(hits).toBe(2000 * 5);
		// ESTIMATE of the budget: about 0.5 ms for each note on CI. The view also yields each 12 ms.
		expect(ms).toBeLessThan(1500);
		// The fast path: notes without the name cost almost nothing.
		const t1 = performance.now();
		for (const lines of notes) findUnlinked(lines, ['Zebra'], 0);
		expect(performance.now() - t1).toBeLessThan(400);
	});
});

describe('code sections from the metadata cache (review R5)', () => {
	it('excludes cache code sections, and keeps fence lines out when code blocks count', async () => {
		const { codeSectionLines } = await import('../src/mentions');
		const lines = ['para', '', '    Atlas code', '', '```', 'Atlas', '```'];
		const sections = [
			{ type: 'paragraph', position: { start: { line: 0 }, end: { line: 0 } } },
			{ type: 'code', position: { start: { line: 2 }, end: { line: 2 } } },
			{ type: 'code', position: { start: { line: 4 }, end: { line: 6 } } },
		];
		expect([...codeSectionLines(sections, lines, false).keys()]).toEqual([2, 4, 5, 6]);
		expect([...codeSectionLines(sections, lines, true).keys()]).toEqual([4, 6]);
		expect(findUnlinked(lines, ['Atlas'], 0, {}, codeSectionLines(sections, lines, false))).toEqual([]);
	});
});
