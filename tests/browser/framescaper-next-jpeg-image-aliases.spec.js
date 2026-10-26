/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, getMenuItem, openNestedCommandMenu } from './audio-editor-test-helpers.js';

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z', 'base64');

test('Generate Add Images native chooser offers supported JPEG filename aliases', async ({ page }) => {
	const handlers = new Map();
	const panels = [];
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async (_window, options) => { panels.push(options); return { canceled: true, filePaths: [] }; },
			showSaveDialog: async () => ({ canceled: true }) },
		handle: (channel, listener) => { handlers.set(channel, listener); },
		opaqueId: String, ownerFor: () => ({}), pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: {}, windowFor: () => null,
	});
	await page.exposeBinding('__nextJpegImageChooser', async (_source, request) => await handlers.get('open')({}, request));
	await page.addInitScript(() => Object.defineProperty(globalThis, 'framescaperDesktop', { enumerable: true, value: Object.freeze({ v1: Object.freeze({
		chooseFiles: request => globalThis.__nextJpegImageChooser(request),
	}) }) }));
	const editor = await bootEditor(page, '/framescaper/en/');
	const menu = await openNestedCommandMenu(page, editor, 'Generate', []);
	await getMenuItem(menu, EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']).click();
	await expect.poll(() => panels.length).toBe(1);
	const extensions = panels[0].filters.flatMap(filter => filter.extensions);
	for (const suffix of ['jfif', 'jpe', 'jpg', 'jpeg', 'png']) expect(extensions).toContain(suffix);
	for (const suffix of ['exe', 'js', 'sscape']) expect(extensions).not.toContain(suffix);
});

for (const suffix of ['jfif', 'jpe']) test(`existing browser image decoder imports JPEG ${suffix} bytes from Generate`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const choosing = page.waitForEvent('filechooser');
	const menu = await openNestedCommandMenu(page, editor, 'Generate', []);
	await getMenuItem(menu, EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']).click();
	await (await choosing).setFiles({ name: `Photo.${suffix}`, mimeType: 'image/jpeg', buffer: JPEG });
	const clip = editor.locator('[data-clip-kind="image"]');
	await expect(clip).toHaveCount(1);
	await expect(clip).toHaveAttribute('aria-label', 'Image clip: Photo');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clip).toHaveCount(0);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(clip).toHaveCount(1);
});
