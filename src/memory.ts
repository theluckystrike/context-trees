// Pure view memory (forum topic 20341): what the view keeps and how bad saved data is repaired. No Obsidian imports.

export type Mode = 'search' | 'backlinks' | 'unlinked';
export type SortOrder = 'default' | 'name' | 'name-desc' | 'modified' | 'modified-asc';
/** How folds start: from the "Fold notes at start" setting, all folded, or all open. */
export type FoldBase = 'default' | 'folded' | 'open';
export type RememberMode = 'off' | 'global' | 'note';

export const SORTS: { id: SortOrder; label: string }[] = [
	{ id: 'default', label: 'Default order' },
	{ id: 'name', label: 'Name, A to Z' },
	{ id: 'name-desc', label: 'Name, Z to A' },
	{ id: 'modified', label: 'Modified, new to old' },
	{ id: 'modified-asc', label: 'Modified, old to new' },
];

export interface ViewMemory {
	mode: Mode;
	query: string;
	regex: boolean;
	caseSensitive: boolean;
	sort: SortOrder;
	fold: FoldBase;
	/** Keys of notes ("path") and branches ("path\u0000line\u0000text") that differ from the fold base. */
	toggled: string[];
}

export interface MemoryStore {
	shared: ViewMemory | null;
	/** Per note, keyed by the path of the open note. Newest use last. */
	notes: Record<string, ViewMemory>;
}

export const NOTES_MAX = 300;
export const TOGGLED_MAX = 500;
export const QUERY_MAX = 1000;
/** Byte limit of the saved per-note state. The oldest notes go first. */
export const NOTES_BYTES_MAX = 200_000;

export const EMPTY_MEMORY: ViewMemory = { mode: 'search', query: '', regex: false, caseSensitive: false, sort: 'default', fold: 'default', toggled: [] };

const MODES: Mode[] = ['search', 'backlinks', 'unlinked'];
const FOLDS: FoldBase[] = ['default', 'folded', 'open'];

/** A branch is its line and its text, so an edit above it does not move the fold to another branch. */
export function branchKey(path: string, line: number, text: string): string {
	return `${path}\u0000${line}\u0000${text.slice(0, 200)}`;
}

/** Repairs one saved memory. Returns null for data that is not an object. */
export function normalizeMemory(raw: unknown): ViewMemory | null {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const r = raw as Partial<Record<keyof ViewMemory, unknown>>;
	const toggled = Array.isArray(r.toggled) ? [...new Set(r.toggled.filter((k): k is string => typeof k === 'string' && k.length > 0))].slice(-TOGGLED_MAX) : [];
	return {
		mode: MODES.includes(r.mode as Mode) ? (r.mode as Mode) : EMPTY_MEMORY.mode,
		query: typeof r.query === 'string' ? r.query.slice(0, QUERY_MAX) : '',
		regex: r.regex === true,
		caseSensitive: r.caseSensitive === true,
		sort: SORTS.some((s) => s.id === r.sort) ? (r.sort as SortOrder) : 'default',
		fold: FOLDS.includes(r.fold as FoldBase) ? (r.fold as FoldBase) : 'default',
		toggled,
	};
}

export function normalizeStore(raw: unknown): MemoryStore {
	const r = (raw !== null && typeof raw === 'object' ? raw : {}) as { shared?: unknown; notes?: unknown };
	const notes: Record<string, ViewMemory> = {};
	if (r.notes !== null && typeof r.notes === 'object' && !Array.isArray(r.notes)) {
		const entries = Object.entries(r.notes as Record<string, unknown>).slice(-NOTES_MAX);
		for (const [path, m] of entries) {
			const n = normalizeMemory(m);
			if (n && path !== '') notes[path] = n;
		}
	}
	return { shared: normalizeMemory(r.shared), notes: capBytes(notes) };
}

/** Flips one key in the toggled list (a fold or unfold by hand). The list keeps the newest TOGGLED_MAX keys. */
export function toggleKey(m: ViewMemory, key: string): ViewMemory {
	const has = m.toggled.includes(key);
	const toggled = has ? m.toggled.filter((k) => k !== key) : [...m.toggled, key].slice(-TOGGLED_MAX);
	return { ...m, toggled };
}

/** Fold all or unfold all: a new base and no exceptions. */
export function foldAllMemory(m: ViewMemory, fold: boolean): ViewMemory {
	return { ...m, fold: fold ? 'folded' : 'open', toggled: [] };
}

/** True when a note in the results is folded. `foldNotes` is the setting "Fold notes at start". */
export function noteFolded(m: ViewMemory, path: string, foldNotes: boolean): boolean {
	const base = m.fold === 'default' ? foldNotes : m.fold === 'folded';
	return m.toggled.includes(path) ? !base : base;
}

/** True when a branch (a node with children) is folded. Branches start open unless "Fold all" was used. */
export function branchFolded(m: ViewMemory, path: string, line: number, text: string): boolean {
	const base = m.fold === 'folded';
	return m.toggled.includes(branchKey(path, line, text)) ? !base : base;
}

/** Saves a memory for a note. The entry moves to the end; the oldest entries go when there are more than NOTES_MAX. */
export function putNote(store: MemoryStore, path: string, m: ViewMemory): MemoryStore {
	const notes: Record<string, ViewMemory> = {};
	for (const [k, v] of Object.entries(store.notes)) if (k !== path) notes[k] = v;
	notes[path] = m;
	const keys = Object.keys(notes);
	for (const k of keys.slice(0, Math.max(0, keys.length - NOTES_MAX))) delete notes[k];
	return { ...store, notes: capBytes(notes) };
}

/** Drops the oldest entries until the JSON of the notes fits NOTES_BYTES_MAX. The newest entry always stays. */
export function capBytes(notes: Record<string, ViewMemory>): Record<string, ViewMemory> {
	const keys = Object.keys(notes);
	const sizes = keys.map((k) => JSON.stringify(k).length + JSON.stringify(notes[k]).length + 2);
	let total = sizes.reduce((a, b) => a + b, 2);
	let drop = 0;
	while (total > NOTES_BYTES_MAX && drop < keys.length - 1) total -= sizes[drop++] as number;
	if (drop === 0) return notes;
	const out: Record<string, ViewMemory> = {};
	for (const k of keys.slice(drop)) out[k] = notes[k] as ViewMemory;
	return out;
}

/** True when the store holds an entry or a fold key for the path. */
export function touchesPath(store: MemoryStore, path: string): boolean {
	const inMem = (m: ViewMemory | null | undefined): boolean => !!m && m.toggled.some((k) => k === path || k.startsWith(`${path}\u0000`));
	return path in store.notes || inMem(store.shared) || Object.values(store.notes).some(inMem);
}

/** Moves the memory of a renamed note and the keys inside every memory. Removes them for a deleted note (newPath null). */
export function movePath(store: MemoryStore, oldPath: string, newPath: string | null): MemoryStore {
	const fix = (m: ViewMemory): ViewMemory => ({
		...m,
		toggled: m.toggled.flatMap((k) => {
			const cut = k.indexOf('\u0000');
			const p = cut < 0 ? k : k.slice(0, cut);
			if (p !== oldPath) return [k];
			if (newPath === null) return [];
			return [cut < 0 ? newPath : newPath + k.slice(cut)];
		}),
	});
	const notes: Record<string, ViewMemory> = {};
	for (const [k, v] of Object.entries(store.notes)) {
		if (k === oldPath) {
			if (newPath !== null) notes[newPath] = fix(v);
		} else notes[k] = fix(v);
	}
	return { shared: store.shared ? fix(store.shared) : null, notes };
}

export interface SortableFile {
	basename: string;
	path: string;
	mtime: number;
}

/** Orders the notes of a scan. "default" keeps the order of 1.3.0: search by modified time, backlinks by path. */
export function sortFiles<T extends SortableFile>(files: T[], sort: SortOrder, mode: Mode): T[] {
	const byName = (a: T, b: T): number => a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path);
	const out = [...files];
	if (sort === 'name') return out.sort(byName);
	if (sort === 'name-desc') return out.sort((a, b) => byName(b, a));
	if (sort === 'modified') return out.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
	if (sort === 'modified-asc') return out.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
	if (mode === 'search') return out.sort((a, b) => b.mtime - a.mtime);
	if (mode === 'backlinks') return out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}
