import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ContextTreesPlugin from '../src/main';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
		listeners: () => fns.size,
	};
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new ContextTreesPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings and clamps the numbers', () => {
		expect(normalizeSettings({ debounceMs: 'x' as never, pageSize: null as never, foldNotes: 1 as never, saved: 'no' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ debounceMs: 5 }).debounceMs).toBe(100);
		expect(normalizeSettings({ debounceMs: 99999 }).debounceMs).toBe(1500);
		expect(normalizeSettings({ pageSize: 3 }).pageSize).toBe(10);
		expect(normalizeSettings({ pageSize: 90000 }).pageSize).toBe(500);
		expect(normalizeSettings({ pageSize: 33.4 }).pageSize).toBe(33);
	});

	it('keeps good saved queries, drops bad ones and caps the list at 50', () => {
		const many = Array.from({ length: 80 }, (_, i) => ({ name: `q${i}`, query: `word${i}`, regex: false, caseSensitive: false }));
		const s = normalizeSettings({ saved: [{ name: '', query: ' alpha ', regex: true } as never, { query: '' } as never, null as never, ...many] });
		expect(s.saved).toHaveLength(50);
		expect(s.saved[0]).toEqual({ name: 'alpha', query: ' alpha ', regex: true, caseSensitive: false });
	});
});

describe('pro facade', () => {
	it('is off with no manager', () => {
		expect(isPro()).toBe(false);
	});

	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		m.set(false);
		expect(cb).toHaveBeenCalledTimes(1);
		expect(isPro()).toBe(false);
	});

	it('reset unbinds the manager', () => {
		const m = fakeManager(true);
		bindPro(m as never);
		expect(m.listeners()).toBe(1);
		resetPro();
		expect(m.listeners()).toBe(0);
		expect(isPro()).toBe(false);
	});

	it('the sponsor terms match product.yaml', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});

describe('timeStamp', () => {
	it('formats local time as YYYY-MM-DD HHmm with zero padding', async () => {
		const { timeStamp } = await import('../src/main');
		expect(timeStamp(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05 0703');
		expect(timeStamp(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31 2359');
	});
});
