import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// First results must come in under 1 s on a 2,000 note vault. The whole scan has a looser default ceiling so a busy
// machine does not fail the run; FX_PERF_STRICT=1 uses the product budget.
const FIRST_BUDGET_MS = 1000;
const SCAN_BUDGET_MS = process.env.FX_PERF_STRICT === '1' ? 1000 : 4000;
const DIR = 'Context Trees';
const ATLAS = `${DIR}/Project Atlas.md`;

interface Stats {
	mode: string;
	scanned: number;
	notes: number;
	hits: number;
	firstMs: number | null;
	totalMs: number;
	done: boolean;
}

/** Runs one search or mode in the view (opens it first) and returns the stats of the scan. */
async function run(mode: 'search' | 'backlinks' | 'unlinked', query = '', opts: { regex?: boolean; caseSensitive?: boolean } = {}): Promise<Stats | null> {
	return browser.executeObsidian(
		async ({ app }, id, m, q, o) => {
			interface View {
				setMode(mode: string): void;
				setQuery(q: string, o: { regex?: boolean; caseSensitive?: boolean }): void;
				runNow(): Promise<Stats | null>;
			}
			interface Plugin {
				open(mode: string): Promise<View | null>;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, Plugin> } }).plugins.plugins[id]!;
			const v = await p.open(m);
			if (!v) return null;
			v.setMode(m);
			v.setQuery(q, o);
			return v.runNow();
		},
		pluginId,
		mode,
		query,
		opts,
	);
}

/** Pro on: a stubbed GitHub Sponsors reply ($5 a month) and a fake token, then Refresh. Pro off: sign out. No real request. */
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			interface Pro {
				opts: { http: unknown };
				refreshNow(): Promise<void>;
				signOut(): void;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

/** The shown tree of one note as text lines: indent by depth, '*' for a hit. */
async function treeOf(name: string): Promise<string[]> {
	return browser.execute((n: string) => {
		const out: string[] = [];
		const walk = (el: Element, depth: number): void => {
			for (const c of Array.from(el.children)) {
				if (!c.classList.contains('ct-node')) continue;
				out.push(`${'  '.repeat(depth)}${c.classList.contains('is-hit') ? '*' : '-'} ${c.querySelector(':scope > .ct-row > .ct-text')?.textContent ?? ''}`);
				const kids = c.querySelector(':scope > .ct-children');
				if (kids) walk(kids, depth + 1);
			}
		};
		const file = Array.from(document.querySelectorAll('.ct-file')).find((f) => f.querySelector('.ct-file-name')?.textContent === n);
		const body = file?.querySelector('.ct-file-body');
		if (body) walk(body, 0);
		return out;
	}, name);
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		// The 2,000-note fixture can take more than the default 30 seconds on a busy Mac.
		await browser.setTimeout({ script: 120_000 });
		await setPro(false);
		await obsidianPage.openFile(ATLAS);
	});

	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('shows each match with its heading path and parent list items', async function () {
		const s = await run('search', 'pricing');
		expect(s).toMatchObject({ notes: 6, hits: 11, done: true });
		expect(await treeOf('2026-09-14 Kickoff')).toEqual([
			'- Kickoff 2026-09-14',
			'  - Decisions',
			'    - Launch scope',
			'      * The pricing table lives on one page',
			'  - Actions',
			'    * Ana: draft the pricing copy for Project Atlas',
		]);
	});

	it('merges matches that share parents and keeps the match case switch', async function () {
		await run('search', 'pricing');
		expect(await treeOf('2026-09-28 Review')).toEqual([
			'- Review 2026-09-28',
			'  - Open questions',
			'    - Plans',
			'      - What happens to old customers',
			'        * Keep the old pricing for 12 months',
			'    - Support',
			'      * Atlas macros wait for the final pricing',
			'  - Risks',
			'    * A late change to the pricing table moves the launch date',
		]);
		expect((await run('search', 'PRICING', { caseSensitive: true }))?.hits).toBe(0);
		expect((await run('search', 'Pricing', { caseSensitive: true }))?.hits).toBe(1);
	});

	it('shows the backlinks of the open note with the same trees', async function () {
		await obsidianPage.openFile(ATLAS);
		const s = await run('backlinks');
		expect(s).toMatchObject({ notes: 4, hits: 5 });
		expect(await treeOf('2026-09-28 Review')).toEqual([
			'- Review 2026-09-28',
			'  - Open questions',
			'    - Plans',
			'      - What happens to old customers',
			'        * Send one email, not three, see Project Atlas',
		]);
	});

	it('opens a readable link target from a result without Pro', async function () {
		await setPro(false);
		await run('search', 'Ana: draft');
		const link = await browser.$('.ct-node.is-hit .ct-link');
		expect(await link.getText()).toBe('Project Atlas');
		await link.click();
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? '')) === ATLAS, { timeout: 8000, timeoutMsg: 'the link target did not open' });
	});

	it('opens the note at the line of a clicked hit', async function () {
		await run('search', 'late change');
		await browser.execute(() => {
			(document.querySelector('.ct-node.is-hit > .ct-row > .ct-text') as HTMLElement).click();
		});
		await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? '')) === `${DIR}/Meetings/2026-09-28 Review.md`, { timeout: 8000, timeoutMsg: 'the note did not open' });
		const line = await browser.executeObsidian(({ app }) => {
			const ed = (app.workspace as unknown as { activeEditor?: { editor?: { getCursor(): { line: number }; getLine(n: number): string } } }).activeEditor?.editor;
			return ed ? ed.getLine(ed.getCursor().line) : '';
		});
		expect(line).toContain('A late change to the pricing table');
	});

	it('folds a note and a branch with their arrows', async function () {
		await run('search', 'pricing');
		const state = await browser.execute(() => {
			const file = document.querySelector('.ct-file') as HTMLElement;
			(file.querySelector('.ct-file-head .ct-toggle') as HTMLElement).click();
			const afterFold = file.classList.contains('is-collapsed');
			(file.querySelector('.ct-file-head .ct-toggle') as HTMLElement).click();
			const branch = file.querySelector('.ct-node .ct-toggle:not(.is-leaf)') as HTMLElement;
			branch.click();
			return { afterFold, branchFolded: (branch.closest('.ct-node') as HTMLElement).classList.contains('is-collapsed') };
		});
		expect(state).toEqual({ afterFold: true, branchFolded: true });
	});

	it('keeps Pro features locked in the free version', async function () {
		await setPro(false);
		const s = await run('search', 'pric(e|ing)', { regex: true });
		// Regex is off without Pro: the text is searched as words, so no line holds the literal text.
		expect(s?.hits).toBe(0);
		const u = await run('unlinked');
		expect(u?.hits).toBe(0);
		const text = await browser.execute(() => document.querySelector('.ct-status')?.textContent ?? '');
		expect(text).toContain('pro feature');
	});

	it('with Pro: regular expression search, unlinked mentions and export', async function () {
		await setPro(true);
		const r = await run('search', 'pric(e|ing)', { regex: true });
		expect(r?.hits).toBeGreaterThan(11);
		await obsidianPage.openFile(ATLAS);
		const u = await run('unlinked');
		expect(u).toMatchObject({ notes: 2, hits: 2 });
		expect(await treeOf('2026-09-28 Review')).toEqual(['- Review 2026-09-28', '  - Open questions', '    - Support', '      * Atlas macros wait for the final pricing']);
		await run('search', 'pricing');
		const exported = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { firstView(): { exportResults(): Promise<{ path: string } | null> } | null }> } }).plugins.plugins[id]!;
			const f = await p.firstView()?.exportResults();
			return f ? { path: f.path, text: await app.vault.adapter.read(f.path) } : null;
		}, pluginId);
		expect(exported?.path).toContain('Context trees pricing');
		expect(exported?.text).toContain('## [[Context Trees/Meetings/2026-09-14 Kickoff.md|2026-09-14 Kickoff]]');
		expect(exported?.text).toContain('==The pricing table lives on one page==');
		await setPro(false);
	});

	it('finds first results in under 1 s on a vault of 2,000 notes', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Bulk');
			const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
			for (let i = 0; i < 2000; i++) {
				const lines = [`# Bulk ${i}`, '', `## ${words[i % 8]} section`, '', `- ${words[(i + 1) % 8]} item`, `  - nested ${words[(i + 2) % 8]} line ${i % 97 === 0 ? 'rareneedle' : ''}`, '', `Paragraph ${i} with ${words[(i + 3) % 8]}.`];
				await app.vault.create(`Bulk/n${i}.md`, lines.join('\n'));
			}
			await new Promise((r) => setTimeout(r, 3000));
		});
		const rare = await run('search', 'rareneedle');
		expect(rare?.notes).toBe(21);
		expect(rare?.firstMs ?? 99999).toBeLessThan(FIRST_BUDGET_MS);
		expect(rare?.totalMs ?? 99999).toBeLessThan(SCAN_BUDGET_MS);
		const common = await run('search', 'alpha');
		expect(common?.notes).toBe(1000);
		expect(common?.firstMs ?? 99999).toBeLessThan(FIRST_BUDGET_MS);
		expect(common?.totalMs ?? 99999).toBeLessThan(SCAN_BUDGET_MS);
		// 50 notes are drawn, the other 950 wait behind "Show more", and one click draws the next 50.
		const paging = await browser.execute(() => {
			const more = document.querySelector('.ct-more-button') as HTMLElement | null;
			const before = document.querySelectorAll('.ct-file').length;
			const label = more?.textContent ?? '';
			more?.click();
			return { before, label, after: document.querySelectorAll('.ct-file').length };
		});
		expect(paging).toEqual({ before: 50, label: 'Show more (950 notes left)', after: 100 });
		await browser.executeObsidian(async ({ app }) => {
			for (const f of app.vault.getMarkdownFiles().filter((x) => x.path.startsWith('Bulk/'))) await app.vault.delete(f);
		});
	});
});
