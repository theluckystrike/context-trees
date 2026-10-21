import { Notice, Plugin, normalizePath, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, ContextTreesSettingTab, normalizeSettings, type ContextTreesSettings } from './settings';
import { ContextTreesView, VIEW_ID, type Mode } from './view';
import { setupHello } from './hello/index';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class ContextTreesPlugin extends Plugin {
	settings: ContextTreesSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	private settingTab: ContextTreesSettingTab | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new ContextTreesSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.registerView(VIEW_ID, (leaf) => new ContextTreesView(leaf, this));
		this.addRibbonIcon('list-tree', 'Open context trees', () => void this.open('search'));
		this.addCommand({ id: 'open', name: 'Open the side view', callback: () => void this.open('search') });
		this.addCommand({ id: 'search', name: 'Search the vault', callback: () => void this.open('search', true) });
		this.addCommand({ id: 'backlinks', name: 'Show backlinks of the current note', callback: () => void this.open('backlinks') });
		this.addCommand({
			id: 'export',
			name: 'Export the results as a note',
			checkCallback: (checking) => {
				const view = this.firstView();
				if (!view) return false;
				if (!checking) void view.exportResults();
				return true;
			},
		});
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	/** The open view, if any. */
	firstView(): ContextTreesView | null {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_ID)[0];
		return leaf?.view instanceof ContextTreesView ? leaf.view : null;
	}

	/** Shows the view in the right sidebar in a mode, and focuses the search box when asked. */
	async open(mode: Mode, focus = false): Promise<ContextTreesView | null> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_ID)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_ID, active: true });
		}
		await workspace.revealLeaf(leaf);
		const view = leaf.view instanceof ContextTreesView ? leaf.view : null;
		view?.setMode(mode);
		if (focus) view?.focusInput();
		return view;
	}

	/** Redraws every open view (settings changed). */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_ID)) if (leaf.view instanceof ContextTreesView) leaf.view.refresh();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<ContextTreesSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Pro: writes Markdown to a new note beside the new-note folder and opens it. */
	async writeExport(markdown: string, label: string): Promise<TFile | null> {
		if (!isPro()) return null;
		const stamp = timeStamp(new Date());
		const clean = label.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
		const title = `Context trees ${clean} ${stamp}`.replace(/\s+/g, ' ');
		const folder = this.app.fileManager.getNewFileParent('');
		const base = normalizePath(`${folder.path === '/' ? '' : folder.path + '/'}${title}`);
		let path = `${base}.md`;
		for (let n = 2; this.app.vault.getAbstractFileByPath(path) && n < 1000; n++) path = `${base} ${n}.md`;
		const file = await this.app.vault.create(path, markdown);
		new Notice(`Exported to ${file.path}`);
		await this.app.workspace.getLeaf('tab').openFile(file);
		return file;
	}
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Local time as YYYY-MM-DD HHmm. Plain Date, so the code does not depend on the moment types. */
export function timeStamp(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
