import { describe, expect, it } from 'vitest';
import { buildTree, contextChain, countHits, headingChain, headingText, itemAt, itemChain, itemText, treeToMarkdown, type ItemRef } from '../src/tree';
import { findHits, findMentions, matchLine, mergeRanges, parseQuery, splitTerms } from '../src/search';
import { frontmatterEnd, outline, structureFromMarkdown, trees } from '../src/reference';

const lines = (s: string): string[] => s.split('\n');

describe('text helpers', () => {
	it('strips list markers, task boxes and heading signs', () => {
		expect(itemText('  - [ ] Buy milk')).toBe('Buy milk');
		expect(itemText('\t* [x] done')).toBe('done');
		expect(itemText('12. twelve')).toBe('twelve');
		expect(itemText('plain text')).toBe('plain text');
		expect(headingText('## Title ##')).toBe('Title');
		expect(headingText('### A # B')).toBe('A # B');
	});
});

describe('heading and item chains', () => {
	const doc = lines('# A\n## B\n### C\n## D\ntext');
	const s = structureFromMarkdown(doc);
	it('keeps the nearest heading of each level', () => {
		expect(headingChain(s.headings, 2).map((h) => h.heading)).toEqual(['A', 'B', 'C']);
		expect(headingChain(s.headings, 4).map((h) => h.heading)).toEqual(['A', 'D']);
		expect(headingChain(s.headings, 0).map((h) => h.heading)).toEqual(['A']);
	});
	it('finds the item that holds a line, with binary search', () => {
		const items: ItemRef[] = [
			{ line: 2, endLine: 3, parent: -2 },
			{ line: 4, endLine: 4, parent: 2 },
			{ line: 9, endLine: 9, parent: -9 },
		];
		expect(itemAt(items, 3)?.line).toBe(2);
		expect(itemAt(items, 4)?.line).toBe(4);
		expect(itemAt(items, 5)).toBeNull();
		expect(itemAt(items, 1)).toBeNull();
		expect(itemAt([], 1)).toBeNull();
		expect(itemChain(items, items[1] as ItemRef).map((i) => i.line)).toEqual([2]);
	});
	it('stops on a broken parent link instead of looping', () => {
		const loop: ItemRef[] = [
			{ line: 5, endLine: 5, parent: 5 },
			{ line: 6, endLine: 6, parent: 99 },
		];
		expect(itemChain(loop, loop[0] as ItemRef)).toEqual([]);
		expect(itemChain(loop, loop[1] as ItemRef)).toEqual([]);
	});
});

describe('context chain and tree', () => {
	const doc = lines('# T\n\n- a\n  - b needle\n  - c\n\ntail needle');
	const s = structureFromMarkdown(doc);
	it('puts the highlight ranges on the shown text, not the raw line', () => {
		const chain = contextChain(doc, s, { line: 3, ranges: [[6, 12]] });
		const last = chain[chain.length - 1];
		expect(last?.text).toBe('b needle');
		expect(last?.ranges).toEqual([[2, 8]]);
	});
	it('merges hits into one tree and counts them', () => {
		const hits = findHits(doc, { terms: ['needle'], regex: null, caseSensitive: false });
		const t = buildTree(doc, s, hits);
		expect(countHits(t)).toBe(2);
		expect(t).toHaveLength(1);
		expect(outline(t)).toEqual(['- # T', '  - a', '    * b <<needle>>', '  * tail <<needle>>']);
	});
	it('writes the tree as an indented Markdown list', () => {
		const t = buildTree(doc, s, findHits(doc, { terms: ['b'], regex: null, caseSensitive: false }));
		expect(treeToMarkdown(t)).toBe('- **T**\n  - a\n    - ==b needle==');
	});
	it('gives an empty tree for no hits', () => {
		expect(buildTree(doc, s, [])).toEqual([]);
		expect(countHits([])).toBe(0);
	});
});

describe('search helpers', () => {
	it('splits words and quoted phrases', () => {
		expect(splitTerms('one "two three" four')).toEqual(['one', 'two three', 'four']);
		expect(splitTerms('   ')).toEqual([]);
	});
	it('merges overlapping ranges', () => {
		expect(mergeRanges([[5, 8], [0, 3], [2, 4], [8, 9]])).toEqual([[0, 4], [5, 9]]);
		expect(mergeRanges([])).toEqual([]);
	});
	it('reports a bad regular expression as an error text', () => {
		const r = parseQuery('(', { regex: true });
		expect(r.ok).toBe(false);
		expect(parseQuery('', {})).toEqual({ ok: false, error: '' });
	});
	it('matches regular expressions that can match nothing without looping', () => {
		const r = parseQuery('x*', { regex: true });
		expect(r.ok && matchLine('abxxc', r.query)).toEqual([[2, 4]]);
		expect(r.ok && matchLine('abc', r.query)).toBeNull();
	});
	it('does not carry state between lines', () => {
		const r = parseQuery('a', { regex: true });
		if (!r.ok) throw new Error('bad');
		expect(matchLine('a', r.query)).toEqual([[0, 1]]);
		expect(matchLine('a', r.query)).toEqual([[0, 1]]);
	});
	it('finds whole word mentions outside links', () => {
		const text = lines('Alpha beta is here\nsee [[Alpha beta]] now\nalphabeta is not a mention\nAlpha beta, and [[x]] Alpha beta');
		const links = new Map<number, [number, number][]>([
			[1, [[4, 16]]],
			[3, [[16, 21]]],
		]);
		const hits = findMentions(text, ['Alpha beta'], links);
		expect(hits.map((h) => h.line)).toEqual([0, 3]);
		expect(hits[0]?.ranges).toEqual([[0, 10]]);
		expect(hits[1]?.ranges).toEqual([[0, 10], [22, 32]]);
	});
	it('ignores names shorter than 2 characters and an empty list', () => {
		expect(findMentions(lines('a b c'), ['a', ' '], new Map())).toEqual([]);
		expect(findMentions(lines('text'), [], new Map())).toEqual([]);
	});
});

describe('reference reader', () => {
	it('skips the properties block and fenced code', () => {
		expect(frontmatterEnd(lines('---\na: 1\n---\n# H'))).toBe(3);
		expect(frontmatterEnd(lines('# H'))).toBe(0);
		expect(frontmatterEnd(lines('---\nnever closed'))).toBe(0);
		const s = structureFromMarkdown(lines('~~~\n# no\n- no\n~~~\n# yes\n- item'));
		expect(s.headings.map((h) => h.heading)).toEqual(['yes']);
		expect(s.items).toHaveLength(1);
	});
	it('uses the cache rule for parents: negative first line for a root item', () => {
		const s = structureFromMarkdown(lines('- a\n  - b\n- c'));
		expect(s.items.map((i) => i.parent)).toEqual([-0, 0, -0]);
		const t = structureFromMarkdown(lines('x\n\n- a\n- b\n  - c'));
		expect(t.items.map((i) => i.parent)).toEqual([-2, -2, 3]);
	});
	it('runs trees on a bad regex without throwing', () => {
		const r = trees('# H\n\ntext', '(', { regex: true });
		expect(r.hits).toBe(0);
		expect(r.error).not.toBe('');
	});
});

describe('audit fixes', () => {
	it('keeps the root items of a list at line 0 apart from the children of line 0', () => {
		expect(trees('- a\n  - b needle\n- c needle', 'needle').outline).toEqual(['- a', '  * b <<needle>>', '* c <<needle>>']);
		// The metadata cache gives 0 or -0 to each root item of a list that starts at line 0, and 0 to each child of line 0.
		const doc = lines('- a\n  - b x\n- c x');
		const s = { headings: [], items: [{ line: 0, endLine: 0, parent: 0 }, { line: 1, endLine: 1, parent: 0 }, { line: 2, endLine: 2, parent: 0 }] };
		const tree = buildTree(doc, s, findHits(doc, (parseQuery('x') as { ok: true; query: never }).query));
		expect(tree.map((n) => n.text)).toEqual(['a', 'c x']);
		expect(tree[0]?.children.map((n) => n.text)).toEqual(['b x']);
		const quoted = lines('> - a\n>   - b x\n> - c x');
		expect(buildTree(quoted, s, findHits(quoted, (parseQuery('x') as { ok: true; query: never }).query)).length).toBe(2);
	});

	it('reads notes with Windows line ends', () => {
		expect(trees('# Head\r\n\r\nneedle here\r\n', 'needle').outline).toEqual(['- # Head', '  * <<needle>> here']);
		expect(trees('# Head\r\nneedle here\r\n', 'here$', { regex: true }).hits).toBe(1);
	});

	it('marks the right columns when lower case changes the length of a character', () => {
		const q = parseQuery('pricing');
		expect(q.ok && matchLine('İstanbul pricing', q.query)).toEqual([[9, 16]]);
		const both = parseQuery('İstanbul');
		expect(both.ok && matchLine('İstanbul pricing', both.query)).toEqual([[0, 8]]);
		expect(findMentions(['İstanbul pricing'], ['Pricing'], new Map())).toEqual([{ line: 0, ranges: [[9, 16]] }]);
	});
});
