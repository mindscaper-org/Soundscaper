/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

/** @param {string} id */
async function projectFile(id) {
	const project = createSoundscaperProject({ id, title: id, trackFolders: [{ id: 'folder', name: 'Folder' }],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'folder', id: 'folder', parentFolderId: null }] }], primarySequenceId: 'main' });
	const exported = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	expect(exported.blob).toBeInstanceOf(Blob);
	return Buffer.from(await exported.blob.arrayBuffer()).toString('base64');
}
/** @param {import('@playwright/test').Page} page @param {string} bytes */
async function launch(page, bytes) {
	await page.evaluate(({ content, mimeType }) => {
		const binary = Uint8Array.from(atob(content), character => character.charCodeAt(0));
		globalThis.__nextFolderLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([binary], 'programme.sscape', { type: mimeType })) }] });
	}, { content: bytes, mimeType: SCAPE_MIME_TYPE });
}

test('an OS-launched native project retires an outgoing folder-name field', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__nextFolderLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/en/');
	await launch(page, await projectFile('folder-outgoing'));
	await expect(editor).toHaveAttribute('data-project-id', 'folder-outgoing'); await waitForProjectActivation(editor);
	const folder = editor.locator('[data-track-folder-row]');
	await folder.press('F2');
	const input = editor.getByRole('textbox', { name: 'Rename folder', exact: true });
	await input.fill('Outgoing folder draft'); await expect(input).toBeFocused();
	await launch(page, await projectFile('folder-incoming'));
	await expect(editor).toHaveAttribute('data-project-id', 'folder-incoming'); await waitForProjectActivation(editor);
	if (await input.count()) await input.press('Tab');
	await expect(folder).toHaveAttribute('aria-label', 'Folder Folder, level 1');
	await expect(input).toHaveCount(0);
});
