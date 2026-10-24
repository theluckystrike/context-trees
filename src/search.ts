// Pure search logic: parse a query, test one line, find the hits of a note. No Obsidian imports.
import type { Hit } from './tree';

export interface Query {
	/** Words and quoted phrases. A line must hold every one of them (case rules below). */
	terms: string[];
	/** Pro: the query is one regular expression. */
	regex: RegExp | null;
	caseSensitive: boolean;
}

export type QueryResult = { ok: true; query: Query } | { ok: false; error: string };

/** Splits the text into words, and keeps "quoted phrases" whole. */
export function splitTerms(text: string): string[] {
	const out: string[] = [];
	const re = /"([^"]+)"|(\S+)/g;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push(m[1] ?? m[2] ?? '');
	return out.filter((t) => t.length > 0);
}

/** Builds a query. In regex mode the text is one pattern; a bad pattern gives an error text, never a throw. */
export function parseQuery(text: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}): QueryResult {
	const caseSensitive = opts.caseSensitive === true;
	const trimmed = text.trim();
	if (trimmed.length === 0) return { ok: false, error: '' };
	if (opts.regex === true) {
		try {
			return { ok: true, query: { terms: [], regex: new RegExp(trimmed, caseSensitive ? 'g' : 'gi'), caseSensitive } };
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : 'Bad regular expression' };
		}
	}
	return { ok: true, query: { terms: splitTerms(trimmed), regex: null, caseSensitive } };
}

/** Lower case with the same length, so columns in the result are columns in the text. A character that changes length (such as İ) stays as it is. */
export function lowerSameLength(text: string): string {
	const lower = text.toLowerCase();
	if (lower.length === text.length) return lower;
	let out = '';
	for (const c of text) {
		const l = c.toLowerCase();
		out += l.length === c.length ? l : c;
	}
	return out;
}

/** Ranges of every match of one term in a line. An empty term gives none. */
function termRanges(hay: string, term: string): [number, number][] {
	const out: [number, number][] = [];
	if (term.length === 0) return out;
	for (let at = hay.indexOf(term); at >= 0 && out.length < 50; at = hay.indexOf(term, at + term.length)) out.push([at, at + term.length]);
	return out;
}

/** Merges overlapping ranges and sorts them. */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const out: [number, number][] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else out.push([r[0], r[1]]);
	}
	return out;
}

/** The ranges where the query hits a line, or null when the line does not match. */
export function matchLine(line: string, q: Query): [number, number][] | null {
	if (q.regex !== null) {
		const re = new RegExp(q.regex.source, q.regex.flags.includes('g') ? q.regex.flags : `${q.regex.flags}g`);
		const out: [number, number][] = [];
		for (let m = re.exec(line); m !== null && out.length < 50; m = re.exec(line)) {
			if (m[0].length === 0) re.lastIndex++;
			else out.push([m.index, m.index + m[0].length]);
		}
		return out.length > 0 ? mergeRanges(out) : null;
	}
	if (q.terms.length === 0) return null;
	const hay = q.caseSensitive ? line : lowerSameLength(line);
	const all: [number, number][] = [];
	for (const t of q.terms) {
		const r = termRanges(hay, q.caseSensitive ? t : lowerSameLength(t));
		if (r.length === 0) return null;
		all.push(...r);
	}
	return mergeRanges(all);
}

/** Hits of a query in the lines of a note, from line `from` on (to skip the properties block). */
export function findHits(lines: string[], q: Query, from = 0): Hit[] {
	const out: Hit[] = [];
	for (let i = Math.max(0, from); i < lines.length; i++) {
		const ranges = matchLine(lines[i] as string, q);
		if (ranges !== null) out.push({ line: i, ranges });
	}
	return out;
}

/** Characters of scripts that do not put spaces between words. */
export const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** True when the code point at UTF-16 column `i` is part of a word. Out of range is false. */
function isWordChar(s: string, i: number): boolean {
	if (i < 0 || i >= s.length) return false;
	// A boundary before the match can land on the low surrogate of the preceding character.
	const unit = s.charCodeAt(i);
	if (unit >= 0xdc00 && unit <= 0xdfff && i > 0) {
		const previous = s.charCodeAt(i - 1);
		if (previous >= 0xd800 && previous <= 0xdbff) i--;
	}
	const point = s.codePointAt(i);
	return point !== undefined && /[\p{L}\p{M}\p{N}_]/u.test(String.fromCodePoint(point));
}

/**
 * Pro: unlinked mentions. Hits where one of the names appears as a whole word, outside the given link ranges.
 * `links` maps a line to the ranges that already are links ([[...]], embeds, Markdown links).
 */
export function findMentions(lines: string[], names: string[], links: Map<number, [number, number][]>, from = 0): Hit[] {
	const wanted = names.map((n) => lowerSameLength(n.trim())).filter((n) => n.length > 1);
	const out: Hit[] = [];
	if (wanted.length === 0) return out;
	for (let i = Math.max(0, from); i < lines.length; i++) {
		const hay = lowerSameLength(lines[i] as string);
		const found: [number, number][] = [];
		for (const name of wanted) {
			for (let at = hay.indexOf(name); at >= 0 && found.length < 50; at = hay.indexOf(name, at + name.length)) {
				const end = at + name.length;
				// Scripts written without spaces (Han, Kana, Thai and others) have no word boundary to test.
				if ((!SPACELESS.test(name[0] as string) && isWordChar(hay, at - 1)) || (!SPACELESS.test(name[name.length - 1] as string) && isWordChar(hay, end))) continue;
				const inLink = (links.get(i) ?? []).some(([a, b]) => at < b && end > a);
				if (!inLink) found.push([at, end]);
			}
		}
		if (found.length > 0) out.push({ line: i, ranges: mergeRanges(found) });
	}
	return out;
}
