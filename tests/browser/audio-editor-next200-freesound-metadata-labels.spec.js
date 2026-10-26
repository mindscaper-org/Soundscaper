/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const custom of [true, false]) test(`Freesound describes imported ${custom ? 'custom' : 'ordinary'} metadata as authored text`, async ({ page }) => {
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		const data = path.endsWith('/oauth/session') ? { connected: true, user: { id: 7, username: 'recorder' } }
			: path.endsWith('/uploads/pending') ? { pendingDescription: [], pendingProcessing: [], pendingModeration: [] }
				: { uploadFilename: 'remote-credits.wav' };
		await route.fulfill({ json: { data } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) {
		await chooseCommandAction(page, editor, 'Window', 'Project bin');
	}
	const metadata = custom ? { constructor: 'Ada', toString: 'Field take', artist: 'Recorder' } : { artist: 'Recorder' };
	const pcm = Float32Array.from({ length: 4800 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
	await editor.locator('[data-project-bin-input]').setInputFiles({ name: 'Credits.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([pcm], { sampleRate: 48_000, float: true, metadata })) });
	await expect(editor.locator('[data-project-bin-item]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as recorder', { exact: true })).toBeVisible();
	await editor.locator('[data-project-bin-item]').getByRole('button', { name: /^More file actions:/u }).press('Enter');
	await page.locator('.kw-audio-editor__project-bin-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
	await expect(panel.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(1);
	await panel.getByRole('button', { name: /^Ready to publish/u }).click();
	const dialog = page.getByRole('dialog', { name: 'Publish to Freesound', exact: true });
	const description = dialog.getByRole('textbox', { name: 'Description', exact: true });
	await expect(description).toHaveValue(/Artist: Recorder/u);
	if (custom) {
		await expect(description).toHaveValue(/Constructor: Ada/u);
		await expect(description).toHaveValue(/ToString: Field take/u);
	}
	await expect(description).not.toHaveValue(/\[native code\]|function Object/u);
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(panel.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(1);
});
