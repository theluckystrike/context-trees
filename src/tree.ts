// Pure logic of Context Trees. No Obsidian imports: the view feeds it text and the metadata cache lists.
// A "line" is a 0-based line number, like the cache positions. A context path is the chain of headings and
// parent list items above one line. A tree merges the paths of all matches in one note, so shared parents show once.

export interface HeadingRef {
	heading: string;
	level: number;
	line: number;
}

export interface ItemRef {
	/** First line of the list item. */
	line: number;
	/** Last line of the list item's own text (children are separate items). */
	endLine: number;
	/** Line of the parent item, or a negative number for a root item (the metadata cache rule). */
	parent: number;
}

export interface NoteStructure {
	headings: HeadingRef[];
	items: ItemRef[];
}

export type NodeKind = 'heading' | 'item' | 'line';

export interface TreeNode {
	kind: NodeKind;
	line: number;
	text: string;
	level?: number;
	/** True when this line is a hit (it holds the query or the link). */
	hit: boolean;
	/** Character ranges [start, end) of the hit inside text. */
	ranges: [number, number][];
	children: TreeNode[];
}

export interface Hit {
	line: number;
	ranges: [number, number][];
}

const MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?/;
const HEADING = /^\s{0,3}#{1,6}\s+/;

/** Text of a list line without its marker and task box. */
export function itemText(line: string): string {
	return line.replace(MARKER, '').trim();
}

/** Text of a heading line without the # signs and closing # signs. */
export function headingText(line: string): string {
	return line.replace(HEADING, '').replace(/\s+#+\s*$/, '').trim();
}

/** Headings above (and at) a line, outermost first. Each level keeps only the nearest heading. */
export function headingChain(headings: HeadingRef[], line: number): HeadingRef[] {
	const stack: HeadingRef[] = [];
	for (const h of headings) {
		if (h.line > line) break;
		while (stack.length > 0 && (stack[stack.length - 1] as HeadingRef).level >= h.level) stack.pop();
		stack.push(h);
	}
	return stack;
}

/** The list item whose own text holds the line, or null. Items are sorted by line. */
export function itemAt(items: ItemRef[], line: number): ItemRef | null {
	let lo = 0;
	let hi = items.length - 1;
	let found: ItemRef | null = null;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const it = items[mid] as ItemRef;
		if (it.line <= line) {
			found = it;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return found !== null && line <= found.endLine ? found : null;
}

/** Parent items of an item, outermost first. Stops at a root item. Bounded by the item count. */
export function itemChain(items: ItemRef[], item: ItemRef): ItemRef[] {
	const out: ItemRef[] = [];
	let cur: ItemRef = item;
	for (let guard = 0; guard < items.length && cur.parent >= 0; guard++) {
		const p = itemAt(items, cur.parent);
		if (p === null || p.line !== cur.parent || p.line >= cur.line) break;
		out.unshift(p);
		cur = p;
	}
	return out;
}

/**
 * The context of one hit as a chain of nodes, outermost first, ending in the hit node.
 * Headings come first, then the parent list items, then the hit (a heading, a list item or a plain line).
 */
export function contextChain(lines: string[], s: NoteStructure, hit: Hit): TreeNode[] {
	const chain: TreeNode[] = [];
	const own = s.headings.find((h) => h.line === hit.line);
	const heads = headingChain(s.headings, hit.line).filter((h) => h.line !== hit.line);
	for (const h of heads) chain.push(node('heading', h.line, h.heading, false, [], h.level));
	if (own) {
		chain.push(node('heading', own.line, headingText(lines[own.line] ?? own.heading), true, shift(hit.ranges, lines[own.line] ?? '', 'heading'), own.level));
		return chain;
	}
	const item = itemAt(s.items, hit.line);
	if (item === null) {
		chain.push(node('line', hit.line, (lines[hit.line] ?? '').trim(), true, shift(hit.ranges, lines[hit.line] ?? '', 'line')));
		return chain;
	}
	for (const p of itemChain(s.items, item)) chain.push(node('item', p.line, itemText(lines[p.line] ?? ''), false, []));
	if (item.line === hit.line) {
		chain.push(node('item', item.line, itemText(lines[item.line] ?? ''), true, shift(hit.ranges, lines[item.line] ?? '', 'item')));
	} else {
		chain.push(node('item', item.line, itemText(lines[item.line] ?? ''), false, []));
		chain.push(node('line', hit.line, (lines[hit.line] ?? '').trim(), true, shift(hit.ranges, lines[hit.line] ?? '', 'line')));
	}
	return chain;
}

function node(kind: NodeKind, line: number, text: string, hitFlag: boolean, ranges: [number, number][], level?: number): TreeNode {
	const n: TreeNode = { kind, line, text, hit: hitFlag, ranges, children: [] };
	if (level !== undefined) n.level = level;
	return n;
}

/** Moves ranges from raw line columns to columns of the shown text (marker, # signs and leading spaces removed). */
function shift(ranges: [number, number][], raw: string, mode: 'item' | 'heading' | 'line'): [number, number][] {
	const shown = mode === 'item' ? itemText(raw) : mode === 'heading' ? headingText(raw) : raw.trim();
	const stripped = mode === 'item' ? raw.replace(MARKER, '') : mode === 'heading' ? raw.replace(HEADING, '') : raw.trimStart();
	const lead = raw.length - stripped.length;
	const out: [number, number][] = [];
	for (const [a, b] of ranges) {
		const s = Math.max(0, a - lead);
		const e = Math.min(shown.length, b - lead);
		if (e > s) out.push([s, e]);
	}
	return out;
}

/** Merges the context chains of all hits in one note into a forest, children sorted by line. */
export function buildTree(lines: string[], s: NoteStructure, hits: Hit[]): TreeNode[] {
	const roots: TreeNode[] = [];
	for (const h of hits) {
		let level = roots;
		for (const n of contextChain(lines, s, h)) {
			let existing = level.find((x) => x.kind === n.kind && x.line === n.line);
			if (!existing) {
				existing = n;
				level.push(n);
				level.sort((a, b) => a.line - b.line);
			} else if (n.hit) {
				existing.hit = true;
				existing.ranges = n.ranges;
			}
			level = existing.children;
		}
	}
	return roots;
}

/** Number of hit nodes in a forest. */
export function countHits(nodes: TreeNode[]): number {
	let n = 0;
	for (const x of nodes) n += (x.hit ? 1 : 0) + countHits(x.children);
	return n;
}

/** Renders a forest as an indented Markdown list: headings in bold, items as they are, hit lines highlighted with ==. */
export function treeToMarkdown(nodes: TreeNode[], depth = 0): string {
	const out: string[] = [];
	for (const x of nodes) {
		const pad = '  '.repeat(depth);
		const label = x.kind === 'heading' ? `**${x.text}**` : x.text;
		out.push(`${pad}- ${x.hit ? `==${label}==` : label}`);
		if (x.children.length > 0) out.push(treeToMarkdown(x.children, depth + 1));
	}
	return out.join('\n');
}
