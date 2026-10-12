import { mergeRanges } from './search';

export interface LinkPart {
	text: string;
	/** Link text for the public openLinkText API. Plain text has no target. */
	target?: string;
	ranges: [number, number][];
}

function escaped(text: string, at: number): boolean {
	let slashes = 0;
	for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
	return slashes % 2 === 1;
}

/** Read wiki links without HTML or media. Keep code, embeds and broken links as text. */
export function linkParts(text: string, ranges: [number, number][] = []): LinkPart[] {
	const parts: LinkPart[] = [];
	const plain = (from: number, to: number): void => {
		if (to <= from) return;
		parts.push({ text: text.slice(from, to), ranges: mergeRanges(ranges.map(([a, b]): [number, number] => [Math.max(from, a) - from, Math.min(to, b) - from]).filter(([a, b]) => b > a)) });
	};
	const tokens = /`+|!?\[\[([^\]\n[]+)\]\]/g;
	let code = '';
	let at = 0;
	for (let m = tokens.exec(text); m !== null; m = tokens.exec(text)) {
		if (escaped(text, m.index)) continue;
		if (m[0].startsWith('`')) {
			if (code === '') code = m[0];
			else if (code === m[0]) code = '';
			continue;
		}
		if (code !== '' || m[0].startsWith('!')) continue;
		const inner = m[1] as string;
		const pipe = inner.indexOf('|');
		// In a table row the alias pipe is escaped as \|. The backslash is not part of the target.
		const target = (pipe < 0 ? inner : inner.slice(0, pipe).replace(/\\$/, '')).trim();
		const label = pipe < 0 ? inner : inner.slice(pipe + 1);
		// A wiki link must name a vault path or a local heading/block, never a URL.
		if (target === '' || label.trim() === '' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
		plain(at, m.index);
		const from = m.index + 2 + (pipe < 0 ? 0 : pipe + 1);
		const to = from + label.length;
		const marks = ranges.map(([a, b]): [number, number] => [Math.max(from, a) - from, Math.min(to, b) - from]).filter(([a, b]) => b > a);
		// If the match is in the hidden path or delimiters, mark the visible label.
		if (ranges.some(([a, b]) => a < m.index + m[0].length && b > m.index && (a < from || b > to))) marks.push([0, label.length]);
		parts.push({ text: label, target, ranges: mergeRanges(marks) });
		at = m.index + m[0].length;
	}
	plain(at, text.length);
	return parts;
}

/** Draw only text nodes and vault link buttons. This does not load an image or run HTML. */
export function drawLinkText(parent: HTMLElement, text: string, ranges: [number, number][]): void {
	for (const part of linkParts(text, ranges)) {
		const el = part.target === undefined ? parent : parent.createEl('button', {
			cls: 'ct-link', attr: { type: 'button', 'data-link': part.target, 'aria-label': `Open ${part.target}`, title: part.target },
		});
		let at = 0;
		for (const [a, b] of part.ranges) {
			if (a > at) el.appendText(part.text.slice(at, a));
			el.createEl('mark', { cls: 'ct-mark', text: part.text.slice(a, b) });
			at = b;
		}
		if (at < part.text.length) el.appendText(part.text.slice(at));
	}
}
