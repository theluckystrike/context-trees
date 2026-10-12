import { ItemView, Keymap, Notice, TFile, getLinkpath, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { isPro, onProChange } from './pro';
import { drawLinkText } from './links';
import { backlinkSources, bodyStart, linkHits, linkRangesByLine, namesOf, structureFor } from './notes';
import { findHits, findMentions, parseQuery } from './search';
import { splitLines } from './reference';
import { buildTree, countHits, treeToMarkdown, type Hit, type TreeNode } from './tree';
import type { SavedQuery } from './settings';
import type ContextTreesPlugin from './main';

export const VIEW_ID = 'context-trees';
export type Mode = 'search' | 'backlinks' | 'unlinked';
const MODES: { id: Mode; label: string }[] = [
	{ id: 'search', label: 'Search' },
	{ id: 'backlinks', label: 'Backlinks' },
	{ id: 'unlinked', label: 'Unlinked mentions' },
];
/** Notes read at once. Reads run in parallel inside a batch; the view redraws and yields between batches. */
const BATCH = 48;

interface FileResult {
	path: string;
	name: string;
	tree: TreeNode[];
	hits: number;
}

export interface ScanStats {
	mode: Mode;
	scanned: number;
	notes: number;
	hits: number;
	/** Milliseconds from the start until the first note with a hit was drawn. null when none. */
	firstMs: number | null;
	totalMs: number;
	done: boolean;
}

const sleep0 = (): Promise<void> => new Promise((r) => window.setTimeout(r, 0));

export class ContextTreesView extends ItemView {
	private mode: Mode = 'search';
	private query = '';
	private regex = false;
	private caseSensitive = false;
	private target: TFile | null = null;
	private token = 0;
	private results: FileResult[] = [];
	private shown = 0;
	private timer: number | null = null;
	private tabsEl!: HTMLElement;
	private inputRow!: HTMLElement;
	private inputEl!: HTMLInputElement;
	private savedEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private moreEl: HTMLElement | null = null;
	/** Stats of the last scan. Read by tests and by the status line. */
	stats: ScanStats | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: ContextTreesPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_ID;
	}
	getDisplayText(): string {
		return 'Context trees';
	}
	getIcon(): string {
		return 'list-tree';
	}

	getState(): Record<string, unknown> {
		return { mode: this.mode, query: this.query, regex: this.regex, caseSensitive: this.caseSensitive };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as { mode?: unknown; query?: unknown; regex?: unknown; caseSensitive?: unknown };
		if (s.mode === 'search' || s.mode === 'backlinks' || s.mode === 'unlinked') this.mode = s.mode;
		if (typeof s.query === 'string') this.query = s.query;
		this.regex = s.regex === true;
		this.caseSensitive = s.caseSensitive === true;
		if (this.inputEl) {
			this.syncHeader();
			this.schedule(0);
		}
		await super.setState(state, result);
	}

	onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('ct-view');
		this.tabsEl = root.createDiv({ cls: 'ct-tabs' });
		this.inputRow = root.createDiv({ cls: 'ct-input-row' });
		this.inputEl = this.inputRow.createEl('input', { cls: 'ct-input', attr: { type: 'search', placeholder: 'Search the vault', 'aria-label': 'Search query' } });
		this.registerDomEvent(this.inputEl, 'input', () => {
			this.query = this.inputEl.value;
			this.schedule(this.plugin.settings.debounceMs);
		});
		this.registerDomEvent(this.inputEl, 'keydown', (e) => {
			if (e.key === 'Enter') this.schedule(0);
		});
		this.savedEl = root.createDiv({ cls: 'ct-saved' });
		this.statusEl = root.createDiv({ cls: 'ct-status' });
		this.bodyEl = root.createDiv({ cls: 'ct-body' });
		this.registerDomEvent(this.bodyEl, 'click', (e) => this.onBodyClick(e));
		this.register(onProChange(() => this.syncHeader()));
		this.registerEvent(
			this.app.workspace.on('file-open', (f) => {
				if (!f) return;
				this.target = f;
				if (this.mode !== 'search') this.schedule(150);
			}),
		);
		const refresh = (): void => {
			if (this.mode !== 'search') this.schedule(900);
		};
		this.registerEvent(this.app.metadataCache.on('resolved', refresh));
		this.registerEvent(this.app.metadataCache.on('changed', refresh));
		this.syncHeader();
		this.schedule(0);
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.token++;
		if (this.timer !== null) window.clearTimeout(this.timer);
		return Promise.resolve();
	}

	/** Puts the cursor in the search box. */
	focusInput(): void {
		this.inputEl.focus();
	}

	/** Opens the view in a given mode (used by commands). */
	setMode(mode: Mode, query?: string): void {
		if (mode !== 'search') this.target = this.app.workspace.getActiveFile() ?? this.target;
		this.mode = mode;
		if (query !== undefined) this.query = query;
		this.syncHeader();
		this.schedule(0);
	}

	/** Runs the current mode now and resolves with its stats. For tests and commands. */
	async runNow(): Promise<ScanStats | null> {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		await this.run();
		return this.stats;
	}

	setQuery(query: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}): void {
		this.query = query;
		this.regex = opts.regex === true;
		this.caseSensitive = opts.caseSensitive === true;
		this.syncHeader();
	}

	private schedule(ms: number): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.run();
		}, ms);
	}

	refresh(): void {
		this.syncHeader();
		this.schedule(0);
	}

	// ---- header -------------------------------------------------------------------------------------------

	private syncHeader(): void {
		if (!this.tabsEl) return;
		this.tabsEl.empty();
		for (const m of MODES) {
			const b = this.tabsEl.createEl('button', { cls: 'ct-tab', text: m.label, attr: { 'aria-pressed': String(m.id === this.mode) } });
			if (m.id === this.mode) b.addClass('is-active');
			if (m.id === 'unlinked' && !isPro()) b.createSpan({ cls: 'ct-pro', text: 'Pro' });
			b.addEventListener('click', () => {
				if (m.id === 'unlinked' && !isPro()) return void this.needsPro('Unlinked mentions');
				this.setMode(m.id);
			});
		}
		const tools = this.tabsEl.createDiv({ cls: 'ct-tools' });
		this.toolButton(tools, 'chevrons-up', 'Fold all', () => this.foldAll(true));
		this.toolButton(tools, 'chevrons-down', 'Unfold all', () => this.foldAll(false));
		this.toolButton(tools, 'download', isPro() ? 'Export results as a note' : 'Export results as a note (Pro)', () => void this.exportResults());

		this.inputRow.toggleClass('is-hidden', this.mode !== 'search');
		if (this.inputEl.value !== this.query) this.inputEl.value = this.query;
		this.inputRow.querySelectorAll('.ct-switch').forEach((n) => n.remove());
		this.switchButton('Aa', 'Match case', this.caseSensitive, () => {
			this.caseSensitive = !this.caseSensitive;
			this.syncHeader();
			this.schedule(0);
		});
		this.switchButton('.*', isPro() ? 'Regular expression' : 'Regular expression (Pro)', this.regex, () => {
			if (!isPro()) return void this.needsPro('Regular expression search');
			this.regex = !this.regex;
			this.syncHeader();
			this.schedule(0);
		});
		this.switchButton('Save', isPro() ? 'Save this query' : 'Save this query (Pro)', false, () => this.saveQuery());
		this.syncSaved();
	}

	private toolButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const b = parent.createEl('button', { cls: 'ct-tool clickable-icon', attr: { 'aria-label': label } });
		setIcon(b, icon);
		b.addEventListener('click', onClick);
	}

	private switchButton(text: string, label: string, on: boolean, onClick: () => void): void {
		const b = this.inputRow.createEl('button', { cls: 'ct-switch', text, attr: { 'aria-label': label, 'aria-pressed': String(on) } });
		if (on) b.addClass('is-active');
		b.addEventListener('click', onClick);
	}

	private syncSaved(): void {
		this.savedEl.empty();
		const list = isPro() && this.mode === 'search' ? this.plugin.settings.saved : [];
		this.savedEl.toggleClass('is-hidden', list.length === 0);
		for (const q of list) {
			const chip = this.savedEl.createDiv({ cls: 'ct-chip' });
			const open = chip.createEl('button', { cls: 'ct-chip-name', text: q.name, attr: { 'aria-label': `Run saved query ${q.name}` } });
			open.addEventListener('click', () => {
				this.setQuery(q.query, q);
				this.schedule(0);
			});
			const del = chip.createEl('button', { cls: 'ct-chip-x clickable-icon', attr: { 'aria-label': `Delete saved query ${q.name}` } });
			setIcon(del, 'x');
			del.addEventListener('click', () => {
				this.plugin.settings.saved = this.plugin.settings.saved.filter((s) => s !== q);
				void this.plugin.saveSettings();
				this.syncSaved();
			});
		}
	}

	private saveQuery(): void {
		if (!isPro()) return void this.needsPro('Saved queries');
		const text = this.query.trim();
		if (text === '') return void new Notice('Type a query first.');
		const entry: SavedQuery = { name: text, query: text, regex: this.regex, caseSensitive: this.caseSensitive };
		const rest = this.plugin.settings.saved.filter((s) => !(s.query === entry.query && s.regex === entry.regex && s.caseSensitive === entry.caseSensitive));
		this.plugin.settings.saved = [entry, ...rest].slice(0, 50);
		void this.plugin.saveSettings();
		this.syncSaved();
	}

	needsPro(feature: string): void {
		new Notice(`${feature} is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
	}

	// ---- scanning -----------------------------------------------------------------------------------------

	private async run(): Promise<void> {
		const token = ++this.token;
		this.results = [];
		this.shown = 0;
		this.moreEl?.remove();
		this.moreEl = null;
		this.bodyEl.empty();
		const t0 = performance.now();
		const stats: ScanStats = { mode: this.mode, scanned: 0, notes: 0, hits: 0, firstMs: null, totalMs: 0, done: false };
		this.stats = stats;
		let files: TFile[] = [];
		let perFile: (file: TFile, lines: string[]) => Hit[];
		if (this.mode === 'search') {
			const parsed = parseQuery(this.query, { regex: this.regex && isPro(), caseSensitive: this.caseSensitive });
			if (!parsed.ok) {
				this.statusEl.setText(parsed.error === '' ? 'Type a query. Each match shows its heading path and the list items above it.' : `Cannot search: ${parsed.error}`);
				stats.done = true;
				return;
			}
			files = this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
			perFile = (file, lines) => findHits(lines, parsed.query, bodyStart(this.app.metadataCache.getFileCache(file), lines));
		} else {
			const target = this.target ?? this.app.workspace.getActiveFile();
			if (!target) {
				this.statusEl.setText('Open a note to see its backlinks.');
				stats.done = true;
				return;
			}
			this.target = target;
			if (this.mode === 'backlinks') {
				files = backlinkSources(this.app, target).sort((a, b) => a.path.localeCompare(b.path));
				perFile = (file) => linkHits(this.app, file, target, this.app.metadataCache.getFileCache(file));
			} else {
				if (!isPro()) {
					this.statusEl.setText('Unlinked mentions are a pro feature. Sponsor on GitHub, then sign in from the plugin settings.');
					stats.done = true;
					return;
				}
				const names = namesOf(this.app, target);
				files = this.app.vault.getMarkdownFiles().filter((f) => f.path !== target.path);
				perFile = (file, lines) => {
					const cache = this.app.metadataCache.getFileCache(file);
					return findMentions(lines, names, linkRangesByLine(cache), bodyStart(cache, lines));
				};
			}
		}
		this.statusEl.setText('Searching...');
		for (let i = 0; i < files.length; i += BATCH) {
			const batch = files.slice(i, i + BATCH);
			const texts = await Promise.all(batch.map((f) => this.app.vault.cachedRead(f).catch(() => '')));
			if (token !== this.token) return;
			for (let k = 0; k < batch.length; k++) {
				const file = batch[k];
				if (!(file instanceof TFile)) continue;
				const lines = splitLines(texts[k] as string);
				stats.scanned++;
				const hits = perFile(file, lines);
				if (hits.length === 0) continue;
				const tree = buildTree(lines, structureFor(this.app.metadataCache.getFileCache(file), lines), hits);
				const n = countHits(tree);
				this.results.push({ path: file.path, name: file.basename, tree, hits: n });
				stats.notes++;
				stats.hits += n;
			}
			this.flush(stats, t0);
			if (i + BATCH < files.length) await sleep0();
			if (token !== this.token) return;
		}
		stats.done = true;
		stats.totalMs = Math.round(performance.now() - t0);
		this.flush(stats, t0);
	}

	/** Draws notes until the first page is full, then updates the status line. Later pages come from "Show more". */
	private flush(stats: ScanStats, t0: number): void {
		const page = this.plugin.settings.pageSize;
		if (this.shown < page) this.drawUpTo(Math.min(this.results.length, page));
		if (stats.firstMs === null && this.shown > 0) stats.firstMs = Math.round(performance.now() - t0);
		stats.totalMs = Math.round(performance.now() - t0);
		const what = stats.mode === 'search' ? 'matches' : stats.mode === 'backlinks' ? 'backlinks' : 'mentions';
		const head = stats.done ? '' : 'Searching... ';
		this.statusEl.setText(stats.hits === 0 && stats.done ? `No ${what} (${stats.scanned} notes checked).` : `${head}${stats.hits} ${what} in ${stats.notes} notes${stats.done ? `, ${stats.totalMs} ms` : ''}.`);
		this.updateMore();
	}

	private drawUpTo(end: number): void {
		for (; this.shown < end; this.shown++) this.drawFile(this.results[this.shown] as FileResult);
	}

	private updateMore(): void {
		const left = this.results.length - this.shown;
		if (left <= 0) {
			this.moreEl?.remove();
			this.moreEl = null;
			return;
		}
		if (!this.moreEl) {
			this.moreEl = this.contentEl.createDiv({ cls: 'ct-more' });
			const b = this.moreEl.createEl('button', { cls: 'ct-more-button' });
			b.addEventListener('click', () => {
				this.drawUpTo(Math.min(this.results.length, this.shown + this.plugin.settings.pageSize));
				this.updateMore();
			});
		}
		(this.moreEl.firstElementChild as HTMLElement).setText(`Show more (${left} notes left)`);
	}

	// ---- drawing ------------------------------------------------------------------------------------------

	private drawFile(r: FileResult): void {
		const el = this.bodyEl.createDiv({ cls: 'ct-file', attr: { 'data-path': r.path } });
		if (this.plugin.settings.foldNotes) el.addClass('is-collapsed');
		const head = el.createDiv({ cls: 'ct-file-head' });
		const tg = head.createSpan({ cls: 'ct-toggle' });
		setIcon(tg, 'chevron-down');
		head.createSpan({ cls: 'ct-file-name', text: r.name, attr: { 'aria-label': r.path } });
		head.createSpan({ cls: 'ct-count', text: String(r.hits) });
		const body = el.createDiv({ cls: 'ct-file-body' });
		for (const n of r.tree) this.drawNode(body, n);
	}

	private drawNode(parent: HTMLElement, n: TreeNode): void {
		const el = parent.createDiv({ cls: `ct-node ct-${n.kind}`, attr: { 'data-line': String(n.line) } });
		if (n.kind === 'heading') el.addClass(`ct-h${String(Math.min(6, n.level ?? 1))}`);
		if (n.hit) el.addClass('is-hit');
		const row = el.createDiv({ cls: 'ct-row' });
		const tg = row.createSpan({ cls: 'ct-toggle' });
		if (n.children.length > 0) setIcon(tg, 'chevron-down');
		else tg.addClass('is-leaf');
		const text = row.createSpan({ cls: 'ct-text' });
		drawLinkText(text, n.text, n.ranges);
		if (n.text === '') text.setText('Empty line');
		if (n.children.length > 0) {
			const kids = el.createDiv({ cls: 'ct-children' });
			for (const c of n.children) this.drawNode(kids, c);
		}
	}

	private foldAll(fold: boolean): void {
		this.bodyEl.querySelectorAll('.ct-file').forEach((f) => f.toggleClass('is-collapsed', fold));
		this.bodyEl.querySelectorAll('.ct-node').forEach((f) => {
			if (f.querySelector(':scope > .ct-children')) f.toggleClass('is-collapsed', fold);
		});
	}

	// ---- clicks -------------------------------------------------------------------------------------------

	private onBodyClick(e: MouseEvent): void {
		const t = e.target as HTMLElement | null;
		if (!t) return;
		const file = t.closest<HTMLElement>('.ct-file');
		if (!file) return;
		const toggle = t.closest('.ct-toggle');
		const node = t.closest<HTMLElement>('.ct-node');
		if (toggle) {
			const owner = toggle.parentElement?.classList.contains('ct-file-head') ? file : node;
			if (owner && (owner === file || owner.querySelector(':scope > .ct-children'))) owner.toggleClass('is-collapsed', !owner.hasClass('is-collapsed'));
			return;
		}
		const path = file.dataset.path;
		if (!path) return;
		const link = t.closest<HTMLElement>('.ct-link');
		if (link?.dataset.link) {
			e.preventDefault();
			e.stopPropagation();
			const linkpath = getLinkpath(link.dataset.link);
			const dest = linkpath === '' ? this.app.vault.getFileByPath(path) : this.app.metadataCache.getFirstLinkpathDest(linkpath, path);
			if (!dest) return void new Notice('That link target does not exist.');
			void this.app.workspace.openLinkText(link.dataset.link, path, Keymap.isModEvent(e));
			return;
		}
		const onNode = t.closest('.ct-row') !== null && node !== null;
		void this.openAt(path, onNode ? Number(node.dataset.line) : null, e);
	}

	/** Opens a note, at a line when one is given. A modifier key opens a new tab. */
	async openAt(path: string, line: number | null, evt: MouseEvent | null): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return void new Notice('That note no longer exists.');
		const leaf = this.app.workspace.getLeaf(evt ? Keymap.isModEvent(evt) : false);
		await leaf.openFile(file, line === null ? undefined : { eState: { line } });
	}

	// ---- export (Pro) ------------------------------------------------------------------------------------

	/** Markdown of the drawn and undrawn results, with context trees. */
	toMarkdown(): string {
		const s = this.stats;
		const head = this.mode === 'search' ? `Search for ${this.query.trim()}` : `${this.mode === 'backlinks' ? 'Backlinks' : 'Unlinked mentions'} of ${this.target?.basename ?? ''}`;
		const lines = [`# ${head}`, '', `${s?.hits ?? 0} results in ${s?.notes ?? 0} notes.`, ''];
		for (const r of this.results) lines.push(`## [[${r.path}|${r.name}]]`, '', treeToMarkdown(r.tree), '');
		return lines.join('\n');
	}

	async exportResults(): Promise<TFile | null> {
		if (!isPro()) {
			this.needsPro('Export');
			return null;
		}
		if (this.results.length === 0) {
			new Notice('No results to export.');
			return null;
		}
		return this.plugin.writeExport(this.toMarkdown(), this.mode === 'search' ? this.query : (this.target?.basename ?? this.mode));
	}
}
