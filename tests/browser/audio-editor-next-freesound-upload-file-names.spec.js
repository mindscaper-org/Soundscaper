/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const [name, expectedName] of [['  Field take.wav', 'Field take.wav'], ['Field\ntake.wave', 'Field-take.wav'], ['Field\u007ftake.wav', 'Field-take.wav']]) {
	test(`Freesound transfers a usable filename for ${JSON.stringify(name)}`, async ({ page }) => {
		const names = [];
		await page.route('**/api/freesound/**', async route => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			if (path.endsWith('/uploads')) {
				const filename = decodeURIComponent(request.headers()['x-freesound-filename']);
				names.push(filename);
				// The exact authenticated endpoint is exercised by the Node regression.
				// Keep its filename admission at this local browser transport boundary.
				if (filename.trim() !== filename || /[\r\n\\/]/u.test(filename) || filename.includes('\u007f')) {
					await route.fulfill({ status: 400, json: { error: { code: 'invalid_upload', message: 'The percent-encoded upload filename is invalid.' } } });
					return;
				}
			}
			const data = path.endsWith('/oauth/session') ? { connected: true, user: { username: 'fixture' } }
				: path.endsWith('/uploads/pending') ? { pendingDescription: [], pendingProcessing: [], pendingModeration: [] }
					: { uploadFilename: 'remote.wav' };
			await route.fulfill({ json: { data } });
		});
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
		const uploads = editor.locator('[data-freesound-uploads="true"]');
		await uploads.getByText('Upload to Freesound', { exact: true }).click();
		await uploads.locator('input[type="file"]').setInputFiles({ name, mimeType: 'audio/wav',
			buffer: Buffer.from(encodeWav([Float32Array.of(.25, -.5)], { sampleRate: 48_000, bitDepth: 16 })) });
		await expect(uploads.locator('li')).toHaveAttribute('data-upload-status', 'ready-to-publish');
		expect(names).toEqual([expectedName]);
	});
}
