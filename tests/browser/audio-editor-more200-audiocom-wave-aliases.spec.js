/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { parseUploadInput } from '../../functions/api/audiocom/_shared/contracts.ts';

for (const extension of ['wav', 'wave', 'rf64', 'bw64']) test(`audio.com publishes an ordinary WAVE file named .${extension}`, async ({ page }) => {
	const file = createWavFixture({ name: `Field take.${extension}`, frequency: 440, duration: .01, channelCount: 1 });
	const sent = [];
	await page.addInitScript(() => {
		const fetch = globalThis.fetch.bind(globalThis);
		globalThis.__waveUploadBody = [];
		globalThis.fetch = async (input, init) => {
			if (String(input).includes('/api/audiocom/uploads?')) globalThis.__waveUploadBody = [...new Uint8Array(await init.body.arrayBuffer())];
			return fetch(input, init);
		};
	});
	await page.route('**/api/audiocom/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/oauth/session')) return route.fulfill({ json: { data: { connected: true } } });
		if (path.endsWith('/usage')) return route.fulfill({ json: { data: { projectStorageSupported: false } } });
		expect(path).toContain('/uploads');
		const request = route.request();
		const bytes = Buffer.from(await page.evaluate(() => globalThis.__waveUploadBody));
		const admitted = parseUploadInput(new Request(request.url(), { method: 'POST', headers: request.headers(), body: bytes }));
		sent.push(admitted); expect(bytes).toEqual(file.buffer);
		return route.fulfill({ json: { data: { processing: false, audio: { id: '123', title: 'Field take', authorName: 'Recorder', username: 'recorder',
			url: 'https://audio.com/recorder/audio/field-take', description: '', license: 'arr', isDownloadable: false, durationSeconds: .01 } } } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'audio.com');
	const uploads = editor.locator('[data-audiocom-uploads]');
	await uploads.locator('summary').click();
	await uploads.locator('input[type="file"]').setInputFiles({ ...file, mimeType: '' });
	const row = uploads.locator('li'); await expect(row).toHaveAttribute('data-upload-status', 'draft');
	await row.getByRole('button', { name: /^Publish/u }).click();
	const dialog = page.locator('[data-audiocom-publish-dialog]');
	await dialog.locator('[name="rightsConfirmed"]').check();
	await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
	await expect(row).toHaveAttribute('data-upload-status', 'complete');
	expect(sent).toHaveLength(1); expect(sent[0].name).toBe(file.name); expect(sent[0].mime).toBe('audio/wav');
});
