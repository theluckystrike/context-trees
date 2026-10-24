// Pure rules for unlinked mentions (forum topic 8599). No Obsidian imports.
// A name match is not an unlinked mention when it touches a link, a Markdown link, a URL, a tag, inline code,
// a fenced code block, the properties block or an ignored term.
import { SPACELESS, findMentions, lowerSameLength } from './search';
import type { Hit } from './tree';

export interface MentionRules {
	/** Count mentions inside fenced code blocks (some people keep prose in code blocks). Inline code never counts. */
	codeBlocks?: boolean;
	/** Words or phrases that never count, matched as whole words in any case. */
	ignore?: string[];
}

// A fence after the blockquote or callout marks (">") and the list indent, so fences in callouts and list items count.
// CommonMark: a backtick fence line has no other backtick after its opening run, so "```x``` here" is inline code.
const FENCE = /^(?:(`{3,})[^`]*$|(~{3,}))/;
const QUOTE = /^(?:[ \t]*>[ \t]?)+/;
const LIST_START = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
// A link label may hold one level of balanced brackets, as in "[the [Atlas] plan](x)".
const LABEL = String.raw`\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\]`;
const DEST = String.raw`(?:<[^>\n]*>|(?:[^\s()\\]|\\.|\([^\n()]*\))*)`;
const TITLE = String.raw`(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?`;
// Wiki links and embeds, Markdown links and images (inline and reference), footnote references, autolinks,
// bare URLs, www addresses, inline math and HTML links. Reference links and %% comments are found separately.
const LINKISH = new RegExp(
	[
		String.raw`!?\[\[[^\]\n]*\]\]`,
		String.raw`\[\^[^\]\n]+\]`,
		`!?${LABEL}\\(${DEST}${TITLE}\\)`,
		String.raw`<[a-z][a-z\d+.-]*:[^>\s]*>`,
		String.raw`\b[a-z][a-z\d+.-]*:\/\/[^\s<>]*`,
		String.raw`\bwww\.[^\s<>]+`,
		// Inline math does not end at a $ that a digit follows, as in Obsidian ("$5 for Atlas,$10").
		String.raw`\$(?=\S)[^$\n]*?\S\$(?!\d)|\$\S\$(?!\d)`,
		String.raw`<a\b[^>]*>.*?<\/a>`,
	].join('|'),
	'giu',
);
// A reference definition line: "[1]: https://..." or "[label]: note.md".
// A footnote definition "[^1]: text" is not one: its text stays searchable. The destination must look like a URL or a path.
const REF_DEF = /^[ \t]{0,3}\[(?!\^)([^\]\n]+)\]:[ \t]*(?:<[^>\n]*>|\S*[:/.#]\S*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/;
// A reference link: full "[text][label]", collapsed "[text][]" or shortcut "[text]".
const REF_LINK = new RegExp(`!?(${LABEL})(?:\\[([^\\]\\n]*)\\])?`, 'gu');

const refKey = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** Labels of the reference definitions in a note, normalized as CommonMark does (case and white space). */
export function referenceLabels(lines: string[], from = 0): Set<string> {
	const out = new Set<string>();
	for (let i = Math.max(0, from); i < lines.length; i++) {
		const m = REF_DEF.exec((lines[i] as string).replace(QUOTE, ''));
		if (m) out.add(refKey(m[1] as string));
	}
	return out;
}

/**
 * Ranges of %% comments in one line. `open` is true when a comment block from an earlier line is still open.
 * Returns the ranges and whether a comment is open at the end of the line.
 */
export function commentRanges(line: string, open: boolean, code: [number, number][] = []): { ranges: [number, number][]; open: boolean } {
	const ranges: [number, number][] = [];
	let start: number | null = open ? 0 : null;
	for (let at = line.indexOf('%%'); at >= 0; at = line.indexOf('%%', at + 2)) {
		// A %% inside inline code is text: it never opens or closes a comment.
		if (code.some(([a, b]) => at >= a && at < b)) continue;
		if (start === null) start = at;
		else {
			ranges.push([start, at + 2]);
			start = null;
		}
	}
	if (start !== null) ranges.push([start, Number.MAX_SAFE_INTEGER]);
	return { ranges, open: start !== null };
}
// A tag starts after a line start or white space. Letters, digits, _, - and / follow.
const TAG = /(^|\s)(#[\p{L}\p{N}_\-/]+)/gu;

function escapedAt(text: string, at: number): boolean {
	let n = 0;
	for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) n++;
	return n % 2 === 1;
}

/** Ranges of inline code spans in one line (CommonMark rule): a run of backticks opens a span only when a run of the same length follows. */
export function codeSpans(line: string): [number, number][] {
	const out: [number, number][] = [];
	const runs: { at: number; len: number }[] = [];
	const ticks = /`+/g;
	for (let m = ticks.exec(line); m !== null; m = ticks.exec(line)) runs.push({ at: m.index, len: m[0].length });
	for (let k = 0; k < runs.length; k++) {
		const open = runs[k] as { at: number; len: number };
		if (escapedAt(line, open.at)) continue;
		const close = runs.findIndex((r, n) => n > k && r.len === open.len);
		if (close < 0) continue;
		const c = runs[close] as { at: number; len: number };
		out.push([open.at, c.at + c.len]);
		k = close;
	}
	return out;
}

/** Ranges of one line where a mention does not count: code spans, links, URLs, tags and ignored terms. */
export function lineExclusions(line: string, ignore: string[] = [], refs: Set<string> = new Set()): [number, number][] {
	const out = codeSpans(line);
	const inCode = (a: number): boolean => out.some(([x, y]) => a >= x && a < y);
	// A reference link counts as a link only when the note defines its label.
	if (refs.size > 0) {
		REF_LINK.lastIndex = 0;
		for (let m = REF_LINK.exec(line); m !== null; m = REF_LINK.exec(line)) {
			if (escapedAt(line, m.index) || inCode(m.index)) continue;
			const text = (m[1] as string).slice(1, -1);
			const label = m[2] === undefined || m[2] === '' ? text : m[2];
			if (refs.has(refKey(label))) out.push([m.index, m.index + m[0].length]);
			else if (m[2] !== undefined && refs.has(refKey(text))) out.push([m.index, m.index + (m[1] as string).length]);
		}
	}
	LINKISH.lastIndex = 0;
	for (let m = LINKISH.exec(line); m !== null; m = LINKISH.exec(line)) {
		if (m[0].startsWith('[') && escapedAt(line, m.index)) {
			// "\[[Name]]" is text. Step past the escaped bracket only.
			LINKISH.lastIndex = m.index + 1;
			continue;
		}
		if (!inCode(m.index)) out.push([m.index, m.index + m[0].length]);
	}
	TAG.lastIndex = 0;
	for (let m = TAG.exec(line); m !== null; m = TAG.exec(line)) {
		const at = m.index + (m[1] as string).length;
		const tag = m[2] as string;
		// "#123" is not a tag in Obsidian: a tag needs one character that is not a digit.
		if (/^#\d+$/.test(tag) || escapedAt(line, at)) continue;
		out.push([at, at + tag.length]);
	}
	if (ignore.length > 0) {
		const hay = lowerSameLength(line);
		for (const term of ignore) {
			const t = lowerSameLength(term.trim());
			if (t.length === 0) continue;
			for (let at = hay.indexOf(t); at >= 0; at = hay.indexOf(t, at + t.length)) {
				if ((!SPACELESS.test(t[0] as string) && isWordAt(hay, at - 1)) || (!SPACELESS.test(t[t.length - 1] as string) && isWordAt(hay, at + t.length))) continue;
				out.push([at, at + t.length]);
			}
		}
	}
	return out;
}

function isWordAt(s: string, i: number): boolean {
	if (i < 0 || i >= s.length) return false;
	return /[\p{L}\p{M}\p{N}_]/u.test(s[i] as string);
}

/**
 * Excluded ranges for each line of a note, from line `from` on (after the properties block).
 * Lines in a fenced code block, fence lines included, are excluded as a whole unless rules.codeBlocks is true.
 */
export function exclusionsByLine(lines: string[], from: number, rules: MentionRules = {}): Map<number, [number, number][]> {
	const out = new Map<number, [number, number][]>();
	const ignore = (rules.ignore ?? []).filter((t) => t.trim().length > 0);
	const whole = (i: number): void => void out.set(i, [[0, Number.MAX_SAFE_INTEGER]]);
	let fence = '';
	let prevBlank = true;
	let inIndented = false;
	let inList = false;
	let inComment = false;
	const refs = referenceLabels(lines, from);
	for (let i = Math.max(0, from); i < lines.length; i++) {
		const line = lines[i] as string;
		// Remove callout and blockquote marks, then the list marker or list indent, before the fence test.
		const quoted = QUOTE.exec(line)?.[0] ?? '';
		const body = line.slice(quoted.length);
		const bare = body.replace(LIST_START, '').replace(/^[ \t]+/, '');
		const f = FENCE.exec(bare);
		if (fence !== '') {
			const run = f ? (f[1] ?? f[2]) : undefined;
			if (run !== undefined && run[0] === fence[0] && run.length >= fence.length && bare.trim() === run) {
				fence = '';
				whole(i);
			} else if (rules.codeBlocks !== true) whole(i);
			else {
				const r = lineExclusions(line, ignore, refs);
				if (r.length > 0) out.set(i, r);
			}
			prevBlank = false;
			continue;
		}
		// %% comments, also a block over more lines.
		const inCommentBefore = inComment;
		// Inside an open comment, backticks are comment text, not code.
		const comments = commentRanges(line, inComment, inComment ? [] : codeSpans(line));
		inComment = comments.open;
		if (f && !inCommentBefore) {
			// A fence line holds the language tag (topic 8599 post 26): it never counts.
			fence = (f[1] ?? f[2]) as string;
			whole(i);
			prevBlank = false;
			continue;
		}
		const blank = body.trim() === '';
		if (LIST_START.test(body)) inList = true;
		else if (!blank && !/^[ \t]/.test(body)) inList = false;
		// An indented code block: 4 spaces or a tab after a blank line, outside a list.
		const indented: boolean = !blank && /^(?: {4}|\t)/.test(body) && !inList && (prevBlank || inIndented);
		inIndented = indented ? true : inIndented && blank;
		prevBlank = blank;
		if (indented && rules.codeBlocks !== true) {
			whole(i);
			continue;
		}
		if (REF_DEF.test(body)) {
			whole(i);
			continue;
		}
		const r = [...lineExclusions(line, ignore, refs), ...comments.ranges];
		if (r.length > 0) out.set(i, r);
	}
	return out;
}

/** Code lines that the metadata cache knows (sections of type "code", also indented code). Fence lines always; content lines unless code blocks count. */
export function codeSectionLines(sections: { type: string; position: { start: { line: number }; end: { line: number } } }[] | undefined, lines: string[], codeBlocks: boolean): Map<number, [number, number][]> {
	const out = new Map<number, [number, number][]>();
	for (const sec of sections ?? []) {
		if (sec.type !== 'code') continue;
		for (let l = sec.position.start.line; l <= sec.position.end.line; l++) {
			const fenceLine = FENCE.test((lines[l] ?? '').replace(QUOTE, '').trim());
			if (fenceLine || !codeBlocks) out.set(l, [[0, Number.MAX_SAFE_INTEGER]]);
		}
	}
	return out;
}

/** Unlinked mentions of the names in a note, with every rule applied. `from` is the first line after the properties block. */
export function findUnlinked(lines: string[], names: string[], from: number, rules: MentionRules = {}, links?: Map<number, [number, number][]>): Hit[] {
	const ignored = new Set((rules.ignore ?? []).map((t) => lowerSameLength(t.trim())).filter((t) => t.length > 0));
	const wanted = names.filter((n) => n.trim().length > 1 && !ignored.has(lowerSameLength(n.trim())));
	if (wanted.length === 0) return [];
	// Fast path: most notes do not hold the name at all. Skip the rules for them.
	const all = lowerSameLength(lines.join('\n'));
	if (!wanted.some((n) => all.includes(lowerSameLength(n.trim())))) return [];
	const ex = exclusionsByLine(lines, from, rules);
	// Links that the metadata cache knows also count as links (the cache reads forms that the text rules do not).
	for (const [line, ranges] of links ?? []) ex.set(line, [...(ex.get(line) ?? []), ...ranges]);
	return findMentions(lines, wanted, ex, from);
}

/** Lines of a setting text box: trimmed, no blanks, no duplicates. */
export function listOf(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const t = raw.trim();
		if (t !== '' && !out.includes(t)) out.push(t);
	}
	return out;
}

/** True when a vault path sits in one of the folders (subfolders too). A folder "/" or "" is ignored. */
export function inFolders(path: string, folders: string[]): boolean {
	return folders.some((f) => {
		const clean = f.replace(/^\/+|\/+$/g, '');
		return clean !== '' && (path === clean || path.startsWith(`${clean}/`));
	});
}

export const OPT_OUT_KEY = 'context-trees-mentions';

/** Reads the opt-out property of a note: false or "none" opts out both ways, "source" or "target" one way. */
export function optOut(frontmatter: Record<string, unknown> | null | undefined): { source: boolean; target: boolean } {
	const v = frontmatter?.[OPT_OUT_KEY];
	if (v === false || (typeof v === 'string' && ['false', 'none', 'no', 'off'].includes(v.trim().toLowerCase()))) return { source: true, target: true };
	if (typeof v === 'string' && v.trim().toLowerCase() === 'source') return { source: true, target: false };
	if (typeof v === 'string' && v.trim().toLowerCase() === 'target') return { source: false, target: true };
	return { source: false, target: false };
}
