/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

test('mixed legacy project import keeps a standalone Sun AU recording', async ({ page, browserName }) => {
	test.skip(browserName !== 'webkit', 'The native Sun AU decoder is available in WebKit; Chromium and Firefox refuse this container.');
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const bytes = new Uint8Array(await dataFile.arrayBuffer()); const view = new DataView(bytes.buffer);
	for (let index = 0; index < 4800; index++) view.setFloat32(24 + index * 4, -.5);
	const independent = { name: 'Independent.au', mimeType: 'audio/basic', buffer: Buffer.from(bytes) };
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [independent]);
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await importFiles(editor, [
		{ name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(await projectFile.arrayBuffer()) },
		{ name: dataFile.name, mimeType: dataFile.type, buffer: Buffer.from(await dataFile.arrayBuffer()) }, independent,
	]);
	await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});


test('mixed legacy project import classifies supported audio by ownership rather than its AU filename', async ({ page }) => {
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const independent = createWavFixture({ name: 'Independent.au', frequency: 330, duration: .2, channelCount: 1 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [independent]);
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await importFiles(editor, [
		{ name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(await projectFile.arrayBuffer()) },
		{ name: dataFile.name, mimeType: dataFile.type, buffer: Buffer.from(await dataFile.arrayBuffer()) }, independent,
	]);
	await expect(editor.locator('.audio-editor-track-row').filter({ hasText: 'Voix 日本語 🎙' })).toBeVisible();
	await expect(clipByName(editor, independent.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
