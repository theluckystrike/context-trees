import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import type ContextTreesPlugin from './main';

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
};

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
	};
}

export class ContextTreesSettingTab extends PluginSettingTab {
	plugin: ContextTreesPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: ContextTreesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Fold notes at start',
				desc: 'On: each note in the results starts folded to its name and match count. Off: each note starts open with its full context tree. You can fold and unfold each branch in the view.',
				control: { type: 'toggle', key: 'foldNotes', defaultValue: DEFAULT_SETTINGS.foldNotes },
			},
			{
				name: 'Notes per page',
				desc: `How many notes the view lists before "Show more", from ${PAGE_MIN} to ${PAGE_MAX}. The search counts every match in the vault either way.`,
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
					? 'Pro is on: regular expression search, unlinked mentions, saved queries and export.'
					: 'Free version: search and backlinks with context trees, fold and unfold, case switch. Pro adds regular expression search, unlinked mentions, saved queries and export.',
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.refreshViews();
	}
}
