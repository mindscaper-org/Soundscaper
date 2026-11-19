import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	registerAudioEditorHooks,
	getMenuItem,
	chooseNestedCommandAction,
} from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { folderEditProject } from '../helpers/folder-edit-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test.describe('audio editor track folder tree', () => {
	registerAudioEditorHooks();

	async function wrapDefaultTrackIntoFolder(page) {
		const editor = await bootEditor(page, '/embed/en/');
		const trackHeader = editor.locator('[data-track-row]').first();
		await trackHeader.getByRole('button', { name: 'Track menu', exact: true }).click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		await trackMenu.getByRole('menuitem', { name: 'Move selection into new folder', exact: true }).click();
		const folderRow = editor.locator('[data-track-folder-row]');
		await expect(folderRow).toHaveCount(1);
		return { editor, folderRow: folderRow.first() };
	}

	test('wrapping a track creates an accessible folder tree over the same ordering', async ({ page }) => {
		const { editor, folderRow } = await wrapDefaultTrackIntoFolder(page);

		await expect(folderRow).toHaveAttribute('role', 'treeitem');
		await expect(folderRow).toHaveAttribute('aria-level', '1');
		await expect(folderRow).toHaveAttribute('aria-posinset', '1');
		await expect(folderRow).toHaveAttribute('aria-setsize', '1');
		await expect(folderRow).toHaveAttribute('aria-expanded', 'true');
		const tree = editor.locator('[role="tree"]');
		await expect(tree).toHaveAttribute('aria-label', 'Track folders');
		await expect(tree).toHaveAttribute('aria-owns', /audio-editor-track-folder-row-/u);
		// The folder row precedes its member track in the flattened order.
		const rows = editor.locator('[data-track-folder-row], [data-track-row]');
		await expect(rows.first()).toHaveAttribute('data-track-folder-row', 'true');

		// One undoable step: a single undo removes the folder again.
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor.locator('[data-track-folder-row]')).toHaveCount(0);
	});

	test('keyboard collapse, rename, and audibility toggles edit the same folder', async ({ page }) => {
		const { editor, folderRow } = await wrapDefaultTrackIntoFolder(page);

		await folderRow.focus();
		await page.keyboard.press('ArrowLeft');
		await expect(folderRow).toHaveAttribute('aria-expanded', 'false');
		await expect(editor.locator('[data-track-row]')).toHaveCount(0);
		await page.keyboard.press('ArrowRight');
		await expect(folderRow).toHaveAttribute('aria-expanded', 'true');
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);

		await page.keyboard.press('Enter');
		const renameInput = editor.getByRole('textbox', { name: 'Rename folder' });
		await expect(renameInput).toBeVisible();
		await renameInput.fill('Rhythm');
		await renameInput.press('Enter');
		await expect(folderRow).toHaveAttribute('aria-label', 'Folder Rhythm, level 1');

		const mute = folderRow.getByRole('button', { name: 'Mute folder' });
		await mute.click();
		await expect(mute).toHaveAttribute('aria-pressed', 'true');
	});

	test('the folder context menu removes the folder while keeping its tracks', async ({ page }) => {
		const { editor, folderRow } = await wrapDefaultTrackIntoFolder(page);

		await folderRow.click({ button: 'right', position: { x: 40, y: 12 } });
		await editor.getByRole('menuitem', { name: 'Delete folder, keep tracks' }).click();
		await expect(editor.locator('[data-track-folder-row]')).toHaveCount(0);
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);
	});

	test('collapsed overview selects nested contents and scopes ripple cut and insert', async ({ page }) => {
		const { project, source } = folderEditProject();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `folder-browser-${crypto.randomUUID()}` });
		let archive;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(source.frameCount).fill(.25)]);
			await writer.commit();
			archive = (await exportScapeProject(project, store)).blob;
		} finally { await store.close(); }
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Folder.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		await expect(editor).not.toHaveAttribute('data-project-activation-pending', 'true');
		const folder = editor.getByRole('treeitem', { name: 'Folder Dialogue, level 1', exact: true });
		await expect(folder).toHaveAttribute('aria-expanded', 'false');
		await expect(editor.locator('[data-track-row]')).toHaveCount(1);
		const command = async label => {
			await folder.click({ button: 'right', position: { x: 40, y: 12 } });
			const menu = page.locator('.audio-editor-track-folder-menu');
			const contents = getMenuItem(menu, 'Edit folder contents');
			await contents.focus();
			await contents.press('ArrowRight');
			await menu.getByRole('menuitem', { name: label, exact: true }).click();
		};
		await command('Select folder contents');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Edit folder contents', 'Select folder contents']);
		const overview = folder.getByRole('group', { name: 'Contents of Dialogue', exact: true });
		await expect(overview).toBeVisible();
		const bounds = await overview.boundingBox();
		expect(bounds).not.toBeNull();
		await page.mouse.move(bounds.x + 20, bounds.y + bounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(bounds.x + 55, bounds.y + bounds.height / 2, { steps: 5 });
		await page.mouse.up();
		const start = editor.getByRole('group', { name: 'Selection start', exact: true });
		await start.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		const samples = async name => Number((await editor.getByRole('group', { name, exact: true }).locator('.timecode-digit').allTextContents()).join(''));
		const duration = await samples('Selection end') - await samples('Selection start');
		expect(duration).toBeGreaterThan(0);
		await command('Cut from folder and close gap');
		await expect.poll(async () => (await persistedProject(page, project.id))?.selection?.trackIds).toEqual(['voice', 'ambience']);
		const later = async id => (await persistedProject(page, project.id)).clips.find(clip => clip.id === id)?.timelineStartFrame;
		await expect.poll(() => later('voice-later')).toBe(144_000 - duration);
		await expect.poll(() => later('ambience-later')).toBe(144_000 - duration);
		await expect.poll(() => later('music-later')).toBe(144_000);
		await command('Insert clipboard into folder');
		await expect.poll(() => later('voice-later')).toBe(144_000);
		await expect.poll(() => later('ambience-later')).toBe(144_000);
		await expect(folder).toHaveAttribute('aria-expanded', 'false');
		await command('Select folder contents');
		const occupied = await overview.locator('.audio-editor-folder-content-span').last().boundingBox();
		expect(occupied).not.toBeNull();
		await page.mouse.click(occupied.x + occupied.width / 2, occupied.y + occupied.height / 2);
		const beforeSplit = await persistedProject(page, project.id);
		await command('Split folder contents');
		for (const trackId of ['voice', 'ambience']) {
			const count = beforeSplit.tracks.find(track => track.id === trackId).clipIds.length;
			await expect.poll(async () => (await persistedProject(page, project.id)).tracks.find(track => track.id === trackId).clipIds.length).toBe(count + 1);
			const afterSplit = await persistedProject(page, project.id), ids = afterSplit.tracks.find(track => track.id === trackId).clipIds;
			const cursor = afterSplit.selection.startFrame;
			expect(cursor).toBeGreaterThan(144_000);
			expect(cursor).toBeLessThan(192_000);
			expect(afterSplit.clips.some(clip => ids.includes(clip.id) && clip.timelineStartFrame === cursor)).toBe(true);
		}
		expect((await persistedProject(page, project.id)).tracks.find(track => track.id === 'music').clipIds).toEqual(beforeSplit.tracks.find(track => track.id === 'music').clipIds);
	});
});
