/* SPDX-License-Identifier: AGPL-3.0-only */
import { freesoundLongM4aFixture } from '../helpers/freesound-long-m4a-fixture.ts';
import { aacLcM4a48_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();
test('a small ten-minute M4A refuses its oversized upload before calling the native decoder', async ({ page }) => {
	const bytes = freesoundLongM4aFixture();
	await page.addInitScript(length => {
		globalThis.__oversizedUploadDecodes = 0;
		const decode = AudioContext.prototype.decodeAudioData;
		AudioContext.prototype.decodeAudioData = function (buffer, ...rest) {
			if (buffer.byteLength === length) globalThis.__oversizedUploadDecodes++;
			return Reflect.apply(decode, this, [buffer, ...rest]);
		};
	}, bytes.length);
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/oauth/session')) await route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'browser-tester' } } } });
		else if (path.endsWith('/uploads/pending')) await route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
		else if (path.endsWith('/uploads')) await route.fulfill({ status: 201, json: { data: { uploadFilename: 'short-recording.wav' } } });
		else await route.fulfill({ status: 404, json: {} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
	const area = panel.locator('[data-freesound-uploads="true"]');
	await area.getByText('Upload to Freesound', { exact: true }).click();
	const choosing = page.waitForEvent('filechooser');
	await area.getByRole('button', { name: 'Choose audio files', exact: true }).click();
	await (await choosing).setFiles({ name: 'podcast.m4a', mimeType: 'audio/mp4', buffer: Buffer.from(bytes) });
	const row = area.locator('li');
	await expect(row).toHaveAttribute('data-upload-status', 'failed', { timeout: 20_000 });
	await expect(row.getByRole('alert')).toContainText('The audio could not be prepared for upload.');
	expect(await page.evaluate(() => globalThis.__oversizedUploadDecodes)).toBe(0);
	await expect(row.getByRole('button', { name: /^Retry\s*:/u })).toBeEnabled();
	const healthy = page.waitForEvent('filechooser');
	await area.getByRole('button', { name: 'Choose audio files', exact: true }).click();
	await (await healthy).setFiles({ name: 'short-recording.m4a', mimeType: 'audio/mp4', buffer: Buffer.from(aacLcM4a48_000Fixture()) });
	await expect(area.locator('li[data-upload-status="ready-to-publish"]')).toHaveCount(1);
	expect(await page.evaluate(() => globalThis.__oversizedUploadDecodes)).toBe(0);
});
