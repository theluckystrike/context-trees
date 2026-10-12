// A small Markdown reader for headings and list items. The plugin uses the Obsidian metadata cache; this reader
// stands in when a note has no cache yet (new note, first start), and it drives the golden vectors in tests.
import { findHits, parseQuery } from './search';
import { linkParts } from './links';
import { buildTree, type HeadingRef, type ItemRef, type NoteStructure, type TreeNode } from './tree';

const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const LIST = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const FENCE = /^ {0,3}(```|~~~)/;

function indentOf(s: string): number {
	let n = 0;
	for (const c of s) n += c === '\t' ? 4 : 1;
	return n;
}

/** First line after a leading properties block (--- ... ---), or 0. */
export function frontmatterEnd(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) if (lines[i]?.trim() === '---') return i + 1;
	return 0;
}

/** Headings and list items of Markdown text. Fenced code is skipped. A list item ends at a blank line. */
export function structureFromMarkdown(lines: string[]): NoteStructure {
	const headings: HeadingRef[] = [];
	const items: ItemRef[] = [];
	const stack: { indent: number; line: number }[] = [];
	let firstOfList = -1;
	let fence = '';
	for (let i = frontmatterEnd(lines); i < lines.length; i++) {
		const raw = lines[i] as string;
		const f = FENCE.exec(raw);
		if (fence !== '') {
			if (f && f[1] === fence) fence = '';
			continue;
		}
		if (f) {
			fence = f[1] as string;
			continue;
		}
		const h = ATX.exec(raw);
		if (h) {
			headings.push({ heading: (h[2] as string).trim(), level: (h[1] as string).length, line: i });
			stack.length = 0;
			firstOfList = -1;
			continue;
		}
		const m = LIST.exec(raw);
		if (m) {
			const indent = indentOf(m[1] as string);
			while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent) stack.pop();
			const parent = stack[stack.length - 1];
			if (firstOfList < 0) firstOfList = i;
			items.push({ line: i, endLine: i, parent: parent ? parent.line : -firstOfList });
			stack.push({ indent, line: i });
			continue;
		}
		const last = items[items.length - 1];
		if (raw.trim() === '') {
			if (last && lines[i + 1] !== undefined && !LIST.test(lines[i + 1] as string) && indentOf(/^[ \t]*/.exec(lines[i + 1] as string)?.[0] ?? '') === 0) {
				stack.length = 0;
				firstOfList = -1;
			}
			continue;
		}
		if (last && last.endLine === i - 1 && indentOf(/^[ \t]*/.exec(raw)?.[0] ?? '') > 0) last.endLine = i;
		else {
			stack.length = 0;
			firstOfList = -1;
		}
	}
	return { headings, items };
}

/** One indented line for each node: "* " marks a hit, "- " a context line, headings start with their # signs, hits sit in <<>>. */
export function outline(nodes: TreeNode[], depth = 0): string[] {
	const out: string[] = [];
	for (const n of nodes) {
		let text = '';
		for (const part of linkParts(n.text, n.ranges)) {
			let at = 0;
			for (const [a, b] of part.ranges) {
				text += `${part.text.slice(at, a)}<<${part.text.slice(a, b)}>>`;
				at = b;
			}
			text += part.text.slice(at);
		}
		const mark = n.kind === 'heading' ? `${'#'.repeat(n.level ?? 1)} ` : '';
		out.push(`${'  '.repeat(depth)}${n.hit ? '*' : '-'} ${mark}${text}`);
		out.push(...outline(n.children, depth + 1));
	}
	return out;
}

export interface TreesOptions {
	regex?: boolean;
	caseSensitive?: boolean;
}

/** Search a Markdown text for a query and return the outline of the merged context tree. The function that the golden vectors test. */
export function trees(markdown: string, queryText: string, opts: TreesOptions = {}): { outline: string[]; hits: number; error: string } {
	const parsed = parseQuery(queryText, opts);
	if (!parsed.ok) return { outline: [], hits: 0, error: parsed.error };
	const lines = markdown.split('\n');
	const hits = findHits(lines, parsed.query, frontmatterEnd(lines));
	const tree = buildTree(lines, structureFromMarkdown(lines), hits);
	return { outline: outline(tree), hits: hits.length, error: '' };
}
