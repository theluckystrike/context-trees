import { describe, expect, it } from 'vitest';
import { EMPTY_MEMORY, NOTES_BYTES_MAX, NOTES_MAX, TOGGLED_MAX, touchesPath, type MemoryStore, branchFolded, branchKey, foldAllMemory, movePath, normalizeMemory, normalizeStore, noteFolded, putNote, sortFiles, toggleKey } from '../src/memory';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';

describe('view memory (topic 20341)', () => {
	it('keeps 1.3.0 behavior by default: memory is off and nothing is saved', () => {
		expect(DEFAULT_SETTINGS.remember).toBe('off');
		expect(normalizeSettings({}).memory).toEqual({ shared: null, notes: {} });
	});

	it('a folded note stays folded, and the fold base follows the setting', () => {
		let m = toggleKey(EMPTY_MEMORY, 'a.md');
		expect(noteFolded(m, 'a.md', false)).toBe(true);
		expect(noteFolded(m, 'b.md', false)).toBe(false);
		expect(noteFolded(m, 'a.md', true)).toBe(false);
		m = toggleKey(m, 'a.md');
		expect(m.toggled).toEqual([]);
	});

	it('fold all folds every note and branch, and clears hand folds', () => {
		const m = foldAllMemory(toggleKey(EMPTY_MEMORY, 'a.md'), true);
		expect(m).toMatchObject({ fold: 'folded', toggled: [] });
		expect(noteFolded(m, 'x.md', false)).toBe(true);
		expect(branchFolded(m, 'x.md', 3, 'Plans')).toBe(true);
		const open = foldAllMemory(m, false);
		expect(noteFolded(open, 'x.md', true)).toBe(false);
		expect(branchFolded(toggleKey(open, branchKey('x.md', 3, 'Plans')), 'x.md', 3, 'Plans')).toBe(true);
	});

	it('repairs bad saved memory', () => {
		expect(normalizeMemory('x')).toBeNull();
		expect(normalizeMemory({ mode: 'nope', sort: 'size', fold: 1, query: 5, toggled: ['a', 'a', 3, ''] })).toEqual({ ...EMPTY_MEMORY, toggled: ['a'] });
		const store = normalizeStore({ shared: [], notes: { 'a.md': { mode: 'backlinks' }, '': {}, 'b.md': null } });
		expect(store).toEqual({ shared: null, notes: { 'a.md': { ...EMPTY_MEMORY, mode: 'backlinks' } } });
		expect(normalizeSettings({ remember: 'always' as never, ignoreTerms: 4 as never, mentionsInCode: 'yes' as never })).toMatchObject({ remember: 'off', ignoreTerms: '', mentionsInCode: false });
	});

	it('caps the hand folds and the notes', () => {
		let m = EMPTY_MEMORY;
		for (let i = 0; i < TOGGLED_MAX + 20; i++) m = toggleKey(m, `n${i}.md`);
		expect(m.toggled).toHaveLength(TOGGLED_MAX);
		expect(m.toggled[0]).toBe('n20.md');
		let store = { shared: null, notes: {} };
		for (let i = 0; i < NOTES_MAX + 5; i++) store = putNote(store, `n${i}.md`, EMPTY_MEMORY);
		store = putNote(store, 'n5.md', { ...EMPTY_MEMORY, sort: 'name' });
		const keys = Object.keys(store.notes);
		expect(keys).toHaveLength(NOTES_MAX);
		expect(keys[0]).toBe('n6.md');
		expect(keys[keys.length - 1]).toBe('n5.md');
	});

	it('follows a renamed note and forgets a deleted one', () => {
		const m = toggleKey(toggleKey(EMPTY_MEMORY, 'a.md'), branchKey('a.md', 4, 'Risks'));
		const store = { shared: m, notes: { 'a.md': m, 'b.md': m } };
		const moved = movePath(store, 'a.md', 'z/a.md');
		expect(Object.keys(moved.notes)).toEqual(['z/a.md', 'b.md']);
		expect(moved.shared?.toggled).toEqual(['z/a.md', branchKey('z/a.md', 4, 'Risks')]);
		const gone = movePath(store, 'a.md', null);
		expect(Object.keys(gone.notes)).toEqual(['b.md']);
		expect(gone.notes['b.md']?.toggled).toEqual([]);
	});

	it('sorts notes in each order, and the default order matches 1.3.0', () => {
		const files = [
			{ basename: 'beta', path: 'b/beta.md', mtime: 1 },
			{ basename: 'Alpha', path: 'z/Alpha.md', mtime: 3 },
			{ basename: 'gamma', path: 'a/gamma.md', mtime: 2 },
		];
		const names = (s: Parameters<typeof sortFiles>[1], mode: Parameters<typeof sortFiles>[2] = 'unlinked') => sortFiles(files, s, mode).map((f) => f.basename);
		expect(names('name')).toEqual(['Alpha', 'beta', 'gamma']);
		expect(names('name-desc')).toEqual(['gamma', 'beta', 'Alpha']);
		expect(names('modified')).toEqual(['Alpha', 'gamma', 'beta']);
		expect(names('modified-asc')).toEqual(['beta', 'gamma', 'Alpha']);
		expect(names('default', 'search')).toEqual(['Alpha', 'gamma', 'beta']);
		expect(names('default', 'backlinks')).toEqual(['gamma', 'beta', 'Alpha']);
		expect(names('default', 'unlinked')).toEqual(['beta', 'Alpha', 'gamma']);
		expect(files[0]?.basename).toBe('beta');
	});
});

describe('view memory limits (review R5)', () => {
	it('keys a branch by its line and its text, so an edit above it does not fold another branch', () => {
		const m = toggleKey(EMPTY_MEMORY, branchKey('a.md', 4, 'Plans'));
		expect(branchFolded(m, 'a.md', 4, 'Plans')).toBe(true);
		expect(branchFolded(m, 'a.md', 4, 'Risks')).toBe(false);
		expect(branchFolded(m, 'a.md', 5, 'Plans')).toBe(false);
	});

	it('caps the per-note state in bytes, keeps the newest entry, and repairs a big store on load', () => {
		const big = { ...EMPTY_MEMORY, query: 'q'.repeat(1000), toggled: Array.from({ length: TOGGLED_MAX }, (_, k) => branchKey(`Projects/a long folder name/note ${k}.md`, k, 'text')) };
		let store: MemoryStore = { shared: null, notes: {} };
		for (let i = 0; i < 50; i++) store = putNote(store, `n${i}.md`, big);
		expect(JSON.stringify(store.notes).length).toBeLessThanOrEqual(NOTES_BYTES_MAX);
		expect(Object.keys(store.notes).pop()).toBe('n49.md');
		const raw = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`n${i}.md`, big]));
		expect(JSON.stringify(normalizeStore({ notes: raw }).notes).length).toBeLessThanOrEqual(NOTES_BYTES_MAX);
	});

	it('finds a path in the store only when it is there', () => {
		const store: MemoryStore = { shared: toggleKey(EMPTY_MEMORY, branchKey('a.md', 1, 'x')), notes: { 'b.md': EMPTY_MEMORY } };
		expect(touchesPath(store, 'a.md')).toBe(true);
		expect(touchesPath(store, 'b.md')).toBe(true);
		expect(touchesPath(store, 'a')).toBe(false);
		expect(touchesPath(store, 'c.md')).toBe(false);
	});

	it('clears the saved state when the mode is Off', () => {
		const memory = { shared: EMPTY_MEMORY, notes: { 'a.md': EMPTY_MEMORY } };
		expect(normalizeSettings({ remember: 'off', memory }).memory).toEqual({ shared: null, notes: {} });
		expect(normalizeSettings({ memory }).memory).toEqual({ shared: null, notes: {} });
		expect(normalizeSettings({ remember: 'global', memory }).memory.notes['a.md']).toEqual(EMPTY_MEMORY);
	});
});
