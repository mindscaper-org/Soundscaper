/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

for (const [name, transferred] of [['Voice\ntake.wav', 'Voice-take.wav'], ['Voice.wav', 'Voice.wav']]) {
	test(`audio.com publishes the selected filename ${JSON.stringify(name)} using an admitted transfer name`, async ({ page }) => {
		const file = createWavFixture({ name, frequency: 440, duration: .01, channelCount: 1 }); const sent = [];
		await page.route('**/api/audiocom/**', async route => {
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith('/oauth/session')) return route.fulfill({ json: { data: { connected: true } } });
			if (path.endsWith('/usage')) return route.fulfill({ json: { data: {} } });
			expect(path).toContain('/uploads');
			const headers = route.request().headers(); const filename = decodeURIComponent(headers['x-audiocom-filename']);
			if ([...filename].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || /[/\\]/u.test(filename)) {
				return route.fulfill({ status: 400, json: { error: { message: 'Invalid upload filename.' } } });
			}
			expect(filename).toBe(transferred); expect(headers['content-type']).toBe('audio/wav'); sent.push(filename);
			return route.fulfill({ json: { data: { processing: false, audio: { id: '123', title: 'Voice', authorName: 'Recorder', username: 'recorder',
				url: 'https://audio.com/recorder/audio/voice', description: '', license: 'arr', isDownloadable: false, durationSeconds: .01 } } } });
		});
		const editor = await bootEditor(page, '/embed/en/'); await chooseCommandAction(page, editor, 'Window', 'audio.com');
		const uploads = editor.locator('[data-audiocom-uploads]'); await uploads.locator('summary').click();
		await uploads.locator('input[type="file"]').setInputFiles(file);
		const row = uploads.locator('li'); await expect(row).toHaveAttribute('data-upload-status', 'draft');
		await row.getByRole('button', { name: /^Publish/u }).click();
		const dialog = page.locator('[data-audiocom-publish-dialog]'); await dialog.locator('[name="rightsConfirmed"]').check();
		await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
		await expect(row).toHaveAttribute('data-upload-status', 'complete'); expect(sent).toEqual([transferred]);
	});
}
