import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type ContextTreesPlugin from './main';
import { normalizeStore, type MemoryStore, type RememberMode } from './memory';
import { helloSettingItems } from './hello/settings';
import { OPT_OUT_KEY } from './mentions';

export interface SavedQuery {
	name: string;
	query: string;
	regex: boolean;
	caseSensitive: boolean;
}

export interface ContextTreesSettings {
	/** Wait in ms after typing before the search starts. */
	debounceMs: number;
	/** Notes shown at once; "Show more" adds this many again. */
	pageSize: number;
	/** Start each note in the results folded to its name and match count. */
	foldNotes: boolean;
	/** Pro: saved queries. */
	saved: SavedQuery[];
	/** Keep the view state: off (1.3.0 behavior), for all notes, or for each note (Pro). */
	remember: RememberMode;
	/** The saved view state. Written by the view. */
	memory: MemoryStore;
	/** Unlinked mentions: words or phrases that never count, one for each line. */
	ignoreTerms: string;
	/** Unlinked mentions: folders whose notes are not searched, one for each line. */
	ignoreFolders: string;
	/** Unlinked mentions: count mentions inside fenced code blocks. */
	mentionsInCode: boolean;
}

export const DEBOUNCE_MIN = 100;
export const DEBOUNCE_MAX = 1500;
export const PAGE_MIN = 10;
export const PAGE_MAX = 500;
export const SAVED_MAX = 50;

export const DEFAULT_SETTINGS: ContextTreesSettings = {
	debounceMs: 250,
	pageSize: 50,
	foldNotes: false,
	saved: [],
	remember: 'off',
	memory: { shared: null, notes: {} },
	ignoreTerms: '',
	ignoreFolders: '',
	mentionsInCode: false,
};

const REMEMBER: RememberMode[] = ['off', 'global', 'note'];
const TEXT_MAX = 20000;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

function normalizeSaved(raw: unknown): SavedQuery[] {
	if (!Array.isArray(raw)) return [];
	const out: SavedQuery[] = [];
	for (const r of raw as Partial<SavedQuery>[]) {
		if (out.length >= SAVED_MAX) break;
		if (typeof r?.query !== 'string' || r.query.trim() === '') continue;
		out.push({ name: typeof r.name === 'string' && r.name.trim() !== '' ? r.name.trim() : r.query.trim(), query: r.query, regex: r.regex === true, caseSensitive: r.caseSensitive === true });
	}
	return out;
}

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<ContextTreesSettings> | null | undefined): ContextTreesSettings {
	const s = saved ?? {};
	return {
		debounceMs: clampInt(s.debounceMs, DEBOUNCE_MIN, DEBOUNCE_MAX, DEFAULT_SETTINGS.debounceMs),
		pageSize: clampInt(s.pageSize, PAGE_MIN, PAGE_MAX, DEFAULT_SETTINGS.pageSize),
		foldNotes: typeof s.foldNotes === 'boolean' ? s.foldNotes : DEFAULT_SETTINGS.foldNotes,
		saved: normalizeSaved(s.saved),
		remember: REMEMBER.includes(s.remember as RememberMode) ? (s.remember as RememberMode) : DEFAULT_SETTINGS.remember,
		// Off keeps nothing: the saved state is cleared.
		memory: s.remember === 'global' || s.remember === 'note' ? normalizeStore(s.memory) : { shared: null, notes: {} },
		ignoreTerms: typeof s.ignoreTerms === 'string' ? s.ignoreTerms.slice(0, TEXT_MAX) : '',
		ignoreFolders: typeof s.ignoreFolders === 'string' ? s.ignoreFolders.slice(0, TEXT_MAX) : '',
		mentionsInCode: s.mentionsInCode === true,
	};
}

export class ContextTreesSettingTab extends PluginSettingTab {
	plugin: ContextTreesPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: ContextTreesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Remember the view state',
				desc: isPro()
					? 'Off: the view starts fresh for each scan, as in version 1.3.0. For all notes: the view keeps its tab, query, sort order and folds, also after a restart. For each note: the view keeps a separate state for each note that you open.'
					: 'Off: the view starts fresh for each scan, as in version 1.3.0. For all notes: the view keeps its tab, query, sort order and folds, also after a restart. For each note is a Pro option; without Pro it works like For all notes.',
				control: { type: 'dropdown', key: 'remember', defaultValue: DEFAULT_SETTINGS.remember, options: { off: 'Off', global: 'For all notes', note: isPro() ? 'For each note' : 'For each note (Pro)' } },
			},
			{
				name: 'Ignored terms',
				desc: 'Unlinked mentions: one word or phrase on each line. A mention inside one of these terms does not count, in any case. A note whose name is on the list shows no unlinked mentions.',
				control: { type: 'textarea', key: 'ignoreTerms', defaultValue: DEFAULT_SETTINGS.ignoreTerms, placeholder: 'Atlas Copco', rows: 4 },
			},
			{
				name: 'Ignored folders',
				desc: `Unlinked mentions: one folder path on each line. Notes in these folders and their subfolders are not searched for mentions, and get no mentions. A note can also opt out with the property ${OPT_OUT_KEY}: false, source or target.`,
				control: { type: 'textarea', key: 'ignoreFolders', defaultValue: DEFAULT_SETTINGS.ignoreFolders, placeholder: 'Templates', rows: 3 },
			},
			{
				name: 'Count mentions in code blocks',
				desc: 'Off: text in fenced code blocks is not searched for unlinked mentions. On: it is searched, for example when you keep prose in a code block. Inline code and the language name of a code block never count.',
				control: { type: 'toggle', key: 'mentionsInCode', defaultValue: DEFAULT_SETTINGS.mentionsInCode },
			},
			{
				name: 'Fold notes at start',
				desc: 'On: each note in the results starts folded to its name and match count. Off: each note starts open with its full context tree. You can fold and unfold each branch in the view.',
				control: { type: 'toggle', key: 'foldNotes', defaultValue: DEFAULT_SETTINGS.foldNotes },
			},
			{
				name: 'Notes per page',
				desc: `How many notes the view lists before "Show more", from ${PAGE_MIN} to ${PAGE_MAX}. The match count also includes the notes that are not listed yet.`,
				control: { type: 'slider', key: 'pageSize', defaultValue: DEFAULT_SETTINGS.pageSize, min: PAGE_MIN, max: PAGE_MAX, step: 10 },
			},
			{
				name: 'Search delay',
				desc: `Milliseconds to wait after you stop typing before the search starts, from ${DEBOUNCE_MIN} to ${DEBOUNCE_MAX}.`,
				control: { type: 'slider', key: 'debounceMs', defaultValue: DEFAULT_SETTINGS.debounceMs, min: DEBOUNCE_MIN, max: DEBOUNCE_MAX, step: 50 },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: regular expression search, saved queries, export and a separate view state for each note.'
					: 'Free version: search, backlinks and unlinked mentions with context trees, fold and unfold, sort, case switch and a remembered view state. Pro adds regular expression search, saved queries, export and a separate view state for each note.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		// Off clears the saved view state: write the cleared data now.
		if (key === 'remember' && value === 'off') await this.plugin.saveSettings();
		this.plugin.refreshViews();
	}
}
