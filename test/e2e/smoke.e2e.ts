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
	maxBlockMs: number;
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

/** Changes plugin settings in place, saves them and redraws the views. */
async function setSettings(values: Record<string, unknown>): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, v) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { settings: Record<string, unknown>; saveSettings(): Promise<void>; refreshViews(): void }> } }).plugins.plugins[id]!;
			Object.assign(p.settings, v);
			await p.saveSettings();
			p.refreshViews();
		},
		pluginId,
		values,
	);
}

/** Folded state of each shown note: path and true when folded. */
async function folds(): Promise<Record<string, boolean>> {
	return browser.execute(() => {
		const out: Record<string, boolean> = {};
		document.querySelectorAll<HTMLElement>('.ct-file').forEach((f) => (out[f.dataset.path ?? ''] = f.classList.contains('is-collapsed')));
		return out;
	});
}

/** Closes every Context Trees view, then opens one without a state, as Obsidian does after a restart, and runs it. */
async function reopenView(): Promise<{ mode: string; sort: string; stats: Stats | null }> {
	return browser.executeObsidian(async ({ app }) => {
		interface View {
			getState(): { mode: string };
			getSort(): string;
			runNow(): Promise<Stats | null>;
		}
		app.workspace.getLeavesOfType('context-trees').forEach((l) => l.detach());
		const leaf = app.workspace.getRightLeaf(false)!;
		await leaf.setViewState({ type: 'context-trees', active: true });
		const v = leaf.view as unknown as View;
		const stats = await v.runNow();
		return { mode: v.getState().mode, sort: v.getSort(), stats };
	});
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
		// The active editor can change one tick after the active file. Wait for the editor of the opened note.
		const cursorLine = (): Promise<string> =>
			browser.executeObsidian(({ app }) => {
				const active = (app.workspace as unknown as { activeEditor?: { file?: { path: string } | null; editor?: { getCursor(): { line: number }; getLine(n: number): string } } }).activeEditor;
				const ed = active?.editor;
				return ed ? `${active?.file?.path ?? ''}|${ed.getLine(ed.getCursor().line)}` : '';
			});
		await browser.waitUntil(async () => (await cursorLine()).startsWith(`${DIR}/Meetings/2026-09-28 Review.md|`), { timeout: 8000, timeoutMsg: 'the editor of the note did not become active' });
		const line = await cursorLine();
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
		const exported = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { firstView(): { exportResults(): Promise<unknown> } | null }> } }).plugins.plugins[id]!;
			return (await p.firstView()?.exportResults()) ?? null;
		}, pluginId);
		expect(exported).toBeNull();
	});

	it('free: unlinked mentions skip links, URLs, tags, code and front matter', async function () {
		await setPro(false);
		await obsidianPage.openFile(ATLAS);
		const u = await run('unlinked');
		expect(u).toMatchObject({ notes: 3, hits: 4, done: true });
		expect(await treeOf('Atlas sources')).toEqual(['* Atlas sources', '  * Atlas reviews need a short summary for each source.']);
		expect(await treeOf('Competitors')).toEqual(['- Competitors', '  * Notes for Project Atlas']);
	});

	it('free: code blocks, ignored terms, ignored folders and the opt-out property', async function () {
		await setPro(false);
		await obsidianPage.openFile(ATLAS);
		await setSettings({ mentionsInCode: true });
		expect((await run('unlinked'))?.hits).toBe(6);
		await setSettings({ mentionsInCode: false, ignoreTerms: 'Atlas reviews\nAtlas macros' });
		expect(await run('unlinked')).toMatchObject({ notes: 2, hits: 2 });
		await setSettings({ ignoreTerms: '', ignoreFolders: 'Context Trees/Research' });
		expect(await run('unlinked')).toMatchObject({ notes: 1, hits: 1 });
		await setSettings({ ignoreFolders: '' });
		const optOut = async (value: string | null, path: string): Promise<void> => {
			await browser.executeObsidian(
				async ({ app }, v, f) => {
					const file = app.vault.getFileByPath(f)!;
					await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
						if (v === null) delete fm['context-trees-mentions'];
						else fm['context-trees-mentions'] = v;
					});
					await new Promise((r) => setTimeout(r, 600));
				},
				value,
				path,
			);
		};
		const sources = `${DIR}/Research/Atlas sources.md`;
		await optOut('source', sources);
		expect(await run('unlinked')).toMatchObject({ notes: 2, hits: 2 });
		await optOut(null, sources);
		await optOut('target', ATLAS);
		const t = await run('unlinked');
		expect(t?.hits).toBe(0);
		expect(await browser.execute(() => document.querySelector('.ct-status')?.textContent ?? '')).toContain('opts out');
		await optOut(null, ATLAS);
		expect((await run('unlinked'))?.hits).toBe(4);
	});

	it('remembers folds, sort and tab for all notes, also after a reload', async function () {
		await setPro(false);
		await setSettings({ remember: 'global', memory: { shared: null, notes: {} } });
		await obsidianPage.openFile(ATLAS);
		await run('backlinks');
		const review = `${DIR}/Meetings/2026-09-28 Review.md`;
		await browser.execute((p: string) => {
			(document.querySelector(`.ct-file[data-path="${p}"] .ct-file-head .ct-toggle`) as HTMLElement).click();
		}, review);
		await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { firstView(): { setSort(s: string): void; runNow(): Promise<unknown> } | null }> } }).plugins.plugins[id]!;
			p.firstView()?.setSort('name-desc');
			await p.firstView()?.runNow();
		}, pluginId);
		expect((await folds())[review]).toBe(true);
		// Another note and back: the fold stays.
		await obsidianPage.openFile(`${DIR}/Reading list.md`);
		await obsidianPage.openFile(ATLAS);
		await browser.pause(400);
		const after = await reopenView();
		expect(after).toMatchObject({ mode: 'backlinks', sort: 'name-desc' });
		expect((await folds())[review]).toBe(true);
		const order = await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('context-trees')[0]!.view as unknown as { resultPaths(): string[] }).resultPaths());
		expect(order).toEqual([...order].sort((a, b) => b.split('/').pop()!.localeCompare(a.split('/').pop()!)));
		// A plugin reload reads data.json again.
		await browser.pause(600);
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		const reloaded = await reopenView();
		expect(reloaded).toMatchObject({ mode: 'backlinks', sort: 'name-desc' });
		expect((await folds())[review]).toBe(true);
	});

	it('a renamed note keeps its fold, and an open view does not write the old path back', async function () {
		await setPro(false);
		await setSettings({ remember: 'global', memory: { shared: null, notes: {} } });
		await obsidianPage.openFile(ATLAS);
		await run('backlinks');
		const review = `${DIR}/Meetings/2026-09-28 Review.md`;
		const renamed = `${DIR}/Meetings/2026-09-28 Review renamed.md`;
		const click = (p: string): Promise<void> =>
			browser.execute((path: string) => {
				(document.querySelector(`.ct-file[data-path="${path}"] .ct-file-head .ct-toggle`) as HTMLElement).click();
			}, p);
		// Start from a known state: no hand folds from the earlier tests, every note open.
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, { firstView(): { foldAll(f: boolean): void } | null }> } }).plugins.plugins[id]!.firstView()?.foldAll(false);
		}, pluginId);
		await click(review);
		expect((await folds())[review]).toBe(true);
		const rename = (from: string, to: string): Promise<void> =>
			browser.executeObsidian(
				async ({ app }, a, b) => {
					await app.fileManager.renameFile(app.vault.getFileByPath(a)!, b);
					await new Promise((r) => setTimeout(r, 900));
				},
				from,
				to,
			);
		await rename(review, renamed);
		try {
			await run('backlinks');
			expect((await folds())[renamed]).toBe(true);
			// A fold of another note saves the view state again. The old path must not come back.
			await click(`${DIR}/Research/Competitors.md`);
			await browser.pause(600);
			const toggled = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, { settings: { memory: { shared: { toggled: string[] } | null } } }> } }).plugins.plugins[id]!.settings.memory.shared?.toggled ?? [], pluginId);
			expect(toggled).toContain(renamed);
			expect(toggled).not.toContain(review);
		} finally {
			await rename(renamed, review);
			await setSettings({ remember: 'off', memory: { shared: null, notes: {} } });
		}
	});

	it('memory off keeps the 1.3.0 behavior: folds reset on the next scan', async function () {
		await setSettings({ remember: 'off', memory: { shared: null, notes: {} } });
		await obsidianPage.openFile(ATLAS);
		await run('backlinks');
		await browser.execute(() => (document.querySelector('.ct-file .ct-file-head .ct-toggle') as HTMLElement).click());
		expect(Object.values(await folds())).toContain(true);
		await run('backlinks');
		expect(Object.values(await folds())).not.toContain(true);
		const saved = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, { settings: { memory: unknown } }> } }).plugins.plugins[id]!.settings.memory, pluginId);
		expect(saved).toEqual({ shared: null, notes: {} });
	});

	it('with Pro: regular expression search, unlinked mentions and export', async function () {
		await setPro(true);
		const r = await run('search', 'pric(e|ing)', { regex: true });
		expect(r?.hits).toBeGreaterThan(11);
		await obsidianPage.openFile(ATLAS);
		const u = await run('unlinked');
		expect(u).toMatchObject({ notes: 3, hits: 4 });
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

	it('with Pro: a separate view state for each note', async function () {
		await setPro(true);
		await setSettings({ remember: 'note', memory: { shared: null, notes: {} } });
		await obsidianPage.openFile(ATLAS);
		await run('backlinks');
		await browser.executeObsidian(({ app }, id) => {
			(app as unknown as { plugins: { plugins: Record<string, { firstView(): { foldAll(f: boolean): void } | null }> } }).plugins.plugins[id]!.firstView()?.foldAll(true);
		}, pluginId);
		const reading = `${DIR}/Reading list.md`;
		await obsidianPage.openFile(reading);
		await browser.pause(500);
		const other = await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, { settings: { memory: { notes: Record<string, { fold: string }> } } }> } }).plugins.plugins[id]!.settings.memory.notes, pluginId);
		expect(other[ATLAS]?.fold).toBe('folded');
		expect(other[reading]?.fold ?? 'default').toBe('default');
		await obsidianPage.openFile(ATLAS);
		await browser.pause(500);
		await browser.executeObsidian(async ({ app }) => {
			await (app.workspace.getLeavesOfType('context-trees')[0]!.view as unknown as { runNow(): Promise<unknown> }).runNow();
		});
		const f = await folds();
		expect(Object.keys(f).length).toBeGreaterThan(0);
		expect(Object.values(f).every(Boolean)).toBe(true);
		// Without Pro, "For each note" works like "For all notes".
		await setPro(false);
		const mode = await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('context-trees')[0]!.view as unknown as { rememberMode(): string }).rememberMode());
		expect(mode).toBe('global');
		await setSettings({ remember: 'off', memory: { shared: null, notes: {} } });
	});

	it('finds first results in under 1 s on a vault of 2,000 notes', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Bulk');
			const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
			for (let i = 0; i < 2000; i++) {
				const lines = [`# Bulk ${i}`, '', `## ${words[i % 8]} section`, '', `- ${words[(i + 1) % 8]} item`, `  - nested ${words[(i + 2) % 8]} line ${i % 97 === 0 ? 'rareneedle' : ''}`, `- see https://x.io/${words[i % 8]} #${words[i % 8]} \`${words[i % 8]}\` [[${words[i % 8]} page]]`, '', `Paragraph ${i} with ${words[(i + 3) % 8]}.`];
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
		// Unlinked mentions of "alpha" read all 2,000 notes and apply every rule. The editor must keep its turns:
		// a 4 ms timer runs during the scan, and its longest gap is the delay that a key press would see.
		await browser.executeObsidian(async ({ app }) => {
			await app.vault.create('Bulk/alpha.md', '# alpha');
			await new Promise((r) => setTimeout(r, 800));
		});
		await obsidianPage.openFile('Bulk/alpha.md');
		const scan = await browser.executeObsidian(async ({ app }, id) => {
			interface View {
				setMode(m: string): void;
				runNow(): Promise<Stats | null>;
			}
			const p = (app as unknown as { plugins: { plugins: Record<string, { open(m: string): Promise<View | null> }> } }).plugins.plugins[id]!;
			const v = (await p.open('unlinked'))!;
			let last = performance.now();
			let gap = 0;
			const timer = window.setInterval(() => {
				const now = performance.now();
				gap = Math.max(gap, now - last);
				last = now;
			}, 4);
			const stats = await v.runNow();
			window.clearInterval(timer);
			return { stats, gap: Math.round(gap) };
		}, pluginId);
		expect(scan.stats).toMatchObject({ notes: 1000, hits: 1000, done: true });
		expect(scan.stats?.maxBlockMs ?? 99999).toBeLessThan(50);
		console.log(`unlinked scan of 2,000 notes: maxBlockMs ${scan.stats?.maxBlockMs ?? -1}, timer gap ${scan.gap} ms`);
		// The timer gap also holds Obsidian's own work during the scan (CI: 39 to 48 ms). README states the measured numbers.
		expect(scan.gap).toBeLessThan(100);
		expect(scan.stats?.firstMs ?? 99999).toBeLessThan(FIRST_BUDGET_MS);
		await browser.executeObsidian(async ({ app }) => {
			for (const f of app.vault.getMarkdownFiles().filter((x) => x.path.startsWith('Bulk/'))) await app.vault.delete(f);
		});
	});
});
