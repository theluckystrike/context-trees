import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { drawLinkText, linkParts } from '../src/links';
import { buildTree, treeToMarkdown } from '../src/tree';
import ContextTreesPlugin from '../src/main';
import { ContextTreesView } from '../src/view';
import manifest from '../manifest.json';

const targets = (text: string) => linkParts(text).filter((p) => p.target !== undefined).map((p) => p.target);

describe('readable internal links', () => {
	it('keeps labels and exact heading and block targets', () => {
		expect(linkParts('See [[Folder/Note#Heading|the plan]] and [[Note#^block]].')).toEqual([
			{ text: 'See ', ranges: [] }, { text: 'the plan', target: 'Folder/Note#Heading', ranges: [] },
			{ text: ' and ', ranges: [] }, { text: 'Note#^block', target: 'Note#^block', ranges: [] }, { text: '.', ranges: [] },
		]);
		expect(targets('[[#Heading|here]] [[#^id]] [[日本語|計画]]')).toEqual(['#Heading', '#^id', '日本語']);
	});

	it('keeps code, embeds, escaped delimiters and broken links as text', () => {
		for (const text of ['`[[Note]]`', '``[[Note]] `code` ``', '`unclosed [[Note]]', '![[Note]]', '\\[[Note]]', '[[Note', '[[|name]]', '[[Note|]]']) {
			expect(targets(text)).toEqual([]);
			expect(linkParts(text).map((p) => p.text).join('')).toBe(text);
		}
		expect(targets('`[[Code]]` [[Real]] ![[Image]] [[Other]]')).toEqual(['Real', 'Other']);
		expect(targets('\\\\[[Real]]')).toEqual(['Real']);
	});

	it('reads a table link with an escaped pipe as its real target', () => {
		expect(linkParts('| [[Note\\|alias]] | x |').filter((p) => p.target !== undefined)).toEqual([{ text: 'alias', target: 'Note', ranges: [] }]);
	});

	it('keeps URLs as text', () => {
		const text = '[[https://example.com|web]] [[javascript:alert(1)|bad]] [[//example.com]] [web](https://example.com) [bad](javascript:alert(1))';
		expect(targets(text)).toEqual([]);
		expect(linkParts(text).map((p) => p.text).join('')).toBe(text);
	});

	it('reads inline Markdown link labels and local targets', () => {
		expect(linkParts('[計画](<資料/Mon%20été%20(1).md#Section>)')).toEqual([{ text: '計画', target: '資料/Mon été (1).md#Section', ranges: [] }]);
		expect(targets('[plan](Note(1).md) [here](#Heading)')).toEqual(['Note(1).md', '#Heading']);
		for (const text of ['![image](Note.md)', '`[code](Note.md)`', '\\[escaped](Note.md)', '[bad](bad%zz.md)', '[web](< https://example.com>)']) expect(targets(text)).toEqual([]);
	});

	it('moves highlights into Markdown labels and marks hidden destinations', () => {
		expect(linkParts('[plan](Target.md)', [[1, 3]])[0]?.ranges).toEqual([[0, 2]]);
		expect(linkParts('[plan](Target.md)', [[7, 13]])[0]?.ranges).toEqual([[0, 4]]);
	});

	it('moves match ranges into aliases and keeps marks after a link', () => {
		expect(linkParts('[[Note|plan]] plan', [[7, 11], [14, 18]])).toEqual([
			{ text: 'plan', target: 'Note', ranges: [[0, 4]] }, { text: ' plan', ranges: [[1, 5]] },
		]);
	});

	it('marks the label when the query matches a hidden path or the full link', () => {
		expect(linkParts('[[Folder/Note|plan]]', [[2, 8]])[0]?.ranges).toEqual([[0, 4]]);
		expect(linkParts('[[Note|plan]]', [[0, 12]])[0]?.ranges).toEqual([[0, 4]]);
		expect(linkParts('[[Note]]', [[3, 5]])[0]?.ranges).toEqual([[1, 3]]);
	});

	it('keeps the original wiki link in the Markdown export', () => {
		const tree = buildTree(['See [[Target#Heading|the plan]]'], { headings: [], items: [] }, [{ line: 0, ranges: [[4, 30]] }]);
		linkParts(tree[0]!.text, tree[0]!.ranges);
		expect(treeToMarkdown(tree)).toBe('- ==See [[Target#Heading|the plan]]==');
	});

	it('draws text and keyboard buttons with no HTML or loaded media', () => {
		const parent = document.createElement('span');
		drawLinkText(parent, '<img src="https://example.com/a.png"> [[Note|<script>bad</script>]]', [[0, 4]]);
		expect(parent.querySelectorAll('img,script,a')).toHaveLength(0);
		expect(parent.querySelector('button')?.textContent).toBe('<script>bad</script>');
		expect(parent.querySelector('button')?.getAttribute('aria-label')).toBe('Open Note');
		expect(parent.querySelector('mark')?.textContent).toBe('<img');
	});
});

describe('link clicks in the view', () => {
	async function viewWithLink(target: string) {
		const app = App.createConfigured__({ files: { 'Source.md': `# Context\nNeedle [[${target}|the target]]`, 'Target.md': '# Heading' } });
		const plugin = new ContextTreesPlugin(app as never, manifest as never);
		const view = new ContextTreesView(app.workspace.getLeaf() as never, plugin);
		await view.onOpen();
		view.setQuery('Needle');
		await view.runNow();
		const open = vi.spyOn(app.workspace, 'openLinkText').mockResolvedValue();
		const source = vi.spyOn(view, 'openAt').mockResolvedValue();
		return { app, view, open, source, button: view.contentEl.querySelector('.ct-link') as HTMLButtonElement };
	}

	it('opens the link target with the source path and does not open the source row', async () => {
		const { view, open, source, button } = await viewWithLink('Target#Heading');
		button.click();
		expect(open).toHaveBeenCalledWith('Target#Heading', 'Source.md', false);
		expect(source).not.toHaveBeenCalled();
		await view.onClose();
	});

	it('opens the target when a match mark inside a link is clicked', async () => {
		const { view, open, source } = await viewWithLink('Target');
		view.setQuery('Target');
		await view.runNow();
		(view.contentEl.querySelector('.ct-link mark') as HTMLElement).click();
		expect(open).toHaveBeenCalledWith('Target', 'Source.md', false);
		expect(source).not.toHaveBeenCalled();
		await view.onClose();
	});

	it('uses the modifier key to open a new tab', async () => {
		const { view, open, button } = await viewWithLink('Target');
		button.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
		expect(open).toHaveBeenCalledWith('Target', 'Source.md', 'tab');
		await view.onClose();
	});

	it('resolves local heading links against the source note', async () => {
		const { view, open, button } = await viewWithLink('#Context');
		button.click();
		expect(open).toHaveBeenCalledWith('#Context', 'Source.md', false);
		await view.onClose();
	});

	it('does not create a note for a missing target', async () => {
		const { app, view, open, source, button } = await viewWithLink('Missing');
		button.click();
		expect(open).not.toHaveBeenCalled();
		expect(source).not.toHaveBeenCalled();
		expect(app.vault.getFileByPath('Missing.md')).toBeNull();
		await view.onClose();
	});

	it('still opens the source line when the row text is clicked', async () => {
		const { view, source } = await viewWithLink('Target');
		(view.contentEl.querySelector('.ct-node.is-hit > .ct-row > .ct-text') as HTMLElement).click();
		expect(source).toHaveBeenCalledWith('Source.md', 1, expect.any(MouseEvent));
		await view.onClose();
	});
});
