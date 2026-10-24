/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();
test('Freesound conversion keeps a legal Unicode filename intact', async ({ page }) => {
	const stem = `${'a'.repeat(219)}🎙`;
	const uploads = [];
	await page.route('**/api/freesound/**', async route => {
		const request = route.request(), path = new URL(request.url()).pathname;
		if (path.endsWith('/oauth/session')) await route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'browser-tester' } } } });
		else if (path.endsWith('/uploads/pending')) await route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
		else if (path.endsWith('/uploads')) {
			uploads.push(decodeURIComponent(request.headers()['x-freesound-filename']));
			await route.fulfill({ status: 201, json: { data: { uploadFilename: 'converted.wav' } } });
		} else await route.fulfill({ status: 404, json: {} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
	const area = panel.locator('[data-freesound-uploads="true"]');
	await area.getByText('Upload to Freesound', { exact: true }).click();
	const choosing = page.waitForEvent('filechooser');
	await area.getByRole('button', { name: 'Choose audio files', exact: true }).click();
	await (await choosing).setFiles(createWavFixture({ name: `${stem}.wave`, duration: .05 }));
	await expect(area.locator('li')).toHaveAttribute('data-upload-status', 'ready-to-publish');
	expect(uploads).toEqual([`${stem}.wav`]);
});
