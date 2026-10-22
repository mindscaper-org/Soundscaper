/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createAudacityWavPackFixture } from '../helpers/wavpack-import-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const kind of ['WavPack', 'low-rate WAV alias']) test(`Freesound uploads the maintained ${kind} format as decoded PCM WAV`, async ({ page }) => {
	const lowRate = kind === 'low-rate WAV alias';
	const original = lowRate ? encodeWav([Float32Array.of(0, .25, -.5, .75)], { sampleRate: 1_000, bitDepth: 16 })
		: await createAudacityWavPackFixture(256);
	// WebKit's request instrumentation omits Blob bodies. Read the same body
	// supplied to the real fetch without replacing the file or upload transport.
	await page.addInitScript(() => {
		const fetch = globalThis.fetch;
		globalThis.fetch = async function (input, init) {
			if (String(input).endsWith('/api/freesound/uploads') && init?.body instanceof Blob) {
				const bytes = new Uint8Array(await init.body.arrayBuffer());
				globalThis.__nextFreesoundUploaded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
			}
			return fetch.call(this, input, init);
		};
	});
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		const data = path.endsWith('/oauth/session') ? { connected: true, user: { username: 'field-recorder' } }
			: path.endsWith('/uploads/pending') ? { pendingDescription: [], pendingProcessing: [], pendingModeration: [] }
				: { uploadFilename: 'field-take.wav' };
		await route.fulfill({ json: { data } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
	const uploads = editor.locator('[data-freesound-uploads="true"]');
	await uploads.getByText('Upload to Freesound', { exact: true }).click();
	await uploads.locator('input[type="file"]').setInputFiles({ name: lowRate ? 'measurement.wave' : 'field-take.wv',
		mimeType: lowRate ? 'audio/wav' : 'audio/wavpack', buffer: Buffer.from(original) });
	const row = uploads.locator('li');
	await expect(row).toHaveAttribute('data-upload-status', 'ready-to-publish');
	const uploaded = Buffer.from(await page.evaluate(() => globalThis.__nextFreesoundUploaded), 'base64');
	expect(uploaded.subarray(0, 4).toString()).toBe('RIFF');
	expect(uploaded.subarray(8, 12).toString()).toBe('WAVE');
	expect(uploaded.readUInt16LE(22)).toBe(lowRate ? 1 : 2);
	expect(uploaded.readUInt32LE(24)).toBe(lowRate ? 1_000 : 48_000);
	expect(uploaded.readUInt16LE(34)).toBe(24);
	expect(uploaded.readUInt32LE(40)).toBe(lowRate ? 4 * 3 : 256 * 2 * 3);
});
