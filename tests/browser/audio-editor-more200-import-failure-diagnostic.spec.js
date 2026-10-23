/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';

test('File Import keeps the failed recording name and decoder explanation beside the summary', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles({ name: 'Broken recording.wav', mimeType: 'audio/wav', buffer: Buffer.from('no decodable audio') });
	const error = page.locator('[data-editor-toast="workspace-status-error"]');
	await expect(error).toContainText('0 file(s) imported, 1 failed');
	await expect(error).toContainText('Broken recording.wav');
	await expect(error).toContainText(/decod|format|RIFF|buffer/iu);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});

test('a mixed File Import keeps healthy PCM and names both failed recordings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles([
		{ name: 'Broken A.wav', mimeType: 'audio/wav', buffer: Buffer.from('no decodable audio') },
		createWavFixture({ name: 'Healthy.wav', frequency: 350, duration: 0.1 }),
		{ name: 'Broken B.wav', mimeType: 'audio/wav', buffer: Buffer.from('also no decodable audio') },
	]);
	const error = page.locator('[data-editor-toast="workspace-status-error"]');
	await expect(error).toContainText('1 file(s) imported, 2 failed');
	await expect(error).toContainText('Broken A.wav'); await expect(error).toContainText('Broken B.wav');
	await expect(error).toContainText(/decod|format|RIFF|buffer/iu);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
