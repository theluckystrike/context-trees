// Glue between the Obsidian metadata cache and the pure logic. Only public API: metadataCache, vault, workspace.
import { getLinkpath, parseFrontMatterAliases, type App, type CachedMetadata, type TFile } from 'obsidian';
import { mergeRanges } from './search';
import { frontmatterEnd, structureFromMarkdown } from './reference';
import type { Hit, NoteStructure } from './tree';

/** Headings and list items of a note, in the shape of the pure logic. Empty when the cache is not ready. */
export function structureOf(cache: CachedMetadata | null): NoteStructure {
	const headings = (cache?.headings ?? []).map((h) => ({ heading: h.heading, level: h.level, line: h.position.start.line }));
	const items = (cache?.listItems ?? []).map((li) => ({ line: li.position.start.line, endLine: li.position.end.line, parent: li.parent }));
	headings.sort((a, b) => a.line - b.line);
	items.sort((a, b) => a.line - b.line);
	return { headings, items };
}

/** Structure from the cache, or from a plain read of the text when the note has no cache yet (new note, first start). */
export function structureFor(cache: CachedMetadata | null, lines: string[]): NoteStructure {
	return cache ? structureOf(cache) : structureFromMarkdown(lines);
}

/** First line after the properties block, or 0 when the note has none. */
export function bodyStart(cache: CachedMetadata | null, lines: string[]): number {
	if (!cache) return frontmatterEnd(lines);
	const fm = cache.frontmatterPosition;
	return fm ? fm.end.line + 1 : 0;
}

/** Notes that link to the target, from the resolved links table. The target itself is left out. */
export function backlinkSources(app: App, target: TFile): TFile[] {
	const out: TFile[] = [];
	const resolved = app.metadataCache.resolvedLinks;
	for (const src of Object.keys(resolved)) {
		if (src === target.path || (resolved[src]?.[target.path] ?? 0) === 0) continue;
		const f = app.vault.getFileByPath(src);
		if (f && f.extension === 'md') out.push(f);
	}
	return out;
}

/** Hits for each link or embed in `source` that resolves to `target`. Ranges are the link text. */
export function linkHits(app: App, source: TFile, target: TFile, cache: CachedMetadata | null): Hit[] {
	const byLine = new Map<number, [number, number][]>();
	for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
		const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(l.link), source.path);
		if (dest?.path !== target.path) continue;
		const line = l.position.start.line;
		const list = byLine.get(line) ?? [];
		const end = l.position.end.line === line ? l.position.end.col : l.position.start.col + l.original.length;
		list.push([l.position.start.col, end]);
		byLine.set(line, list);
	}
	return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([line, r]) => ({ line, ranges: mergeRanges(r) }));
}

/** Ranges of every link on each line of a note. Used to keep unlinked mentions apart from linked ones. */
export function linkRangesByLine(cache: CachedMetadata | null): Map<number, [number, number][]> {
	const out = new Map<number, [number, number][]>();
	for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
		const line = l.position.start.line;
		const list = out.get(line) ?? [];
		list.push([l.position.start.col, l.position.end.line === line ? l.position.end.col : Number.MAX_SAFE_INTEGER]);
		out.set(line, list);
	}
	return out;
}

/** The names that a mention of this note can use: its file name and its aliases. */
export function namesOf(app: App, file: TFile): string[] {
	const aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter ?? null) ?? [];
	return [file.basename, ...aliases.filter((a) => typeof a === 'string')];
}
