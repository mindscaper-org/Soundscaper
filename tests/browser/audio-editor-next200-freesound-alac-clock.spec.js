/* SPDX-License-Identifier: AGPL-3.0-only */
import { alacM4a48_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();
test('Freesound lossless ALAC conversion preserves the source clock on a 44.1 kHz device', async ({ page }) => {
	await page.addInitScript(() => {
		const NativeContext = globalThis.AudioContext;
		globalThis.AudioContext = class extends NativeContext {
			constructor(options) { super({ ...options, sampleRate: options?.sampleRate ?? 44_100 }); }
		};
		globalThis.__alacUploadBodies = [];
		const nativeFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			if (new URL(String(input), location.href).pathname === '/api/freesound/uploads' && init?.body instanceof Blob) {
				const bytes = new Uint8Array(await init.body.arrayBuffer());
				let binary = '';
				for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
				globalThis.__alacUploadBodies.push(btoa(binary));
			}
			return Reflect.apply(nativeFetch, globalThis, [input, init]);
		};
	});
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/oauth/session')) await route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'browser-tester' } } } });
		else if (path.endsWith('/uploads/pending')) await route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
		else if (path.endsWith('/uploads')) await route.fulfill({ status: 201, json: { data: { uploadFilename: 'remote-lossless.wav' } } });
		else await route.fulfill({ status: 404, json: {} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = alacM4a48_000Fixture();
	const reference = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const decoded = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return Array.from({ length: decoded.numberOfChannels }, (_, channel) => [...decoded.getChannelData(channel)]);
		} catch { return null; } finally { await context.close(); }
	}, [...bytes]);
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
	const area = panel.locator('[data-freesound-uploads="true"]');
	await area.getByText('Upload to Freesound', { exact: true }).click();
	const choosing = page.waitForEvent('filechooser');
	await area.getByRole('button', { name: 'Choose audio files', exact: true }).click();
	await (await choosing).setFiles({ name: 'lossless.m4a', mimeType: 'audio/mp4', buffer: Buffer.from(bytes) });
	if (!reference) {
		await expect(area.getByRole('button', { name: /^Retry\s*:/u })).toHaveCount(1);
		expect(await page.evaluate(() => globalThis.__alacUploadBodies)).toEqual([]);
		return;
	}
	await expect(area.getByRole('button', { name: /^Ready to publish\s*:/u })).toHaveCount(1);
	const uploaded = await page.evaluate(() => globalThis.__alacUploadBodies);
	expect(uploaded).toHaveLength(1);
	const blob = new Blob([Buffer.from(uploaded[0], 'base64')]);
	const descriptor = await inspectWavBlobPcm(blob);
	expect(descriptor.sampleRate).toBe(48_000);
	expect(descriptor.frameCount).toBe(4800);
	expect(descriptor.channelCount).toBe(2);
	const actual = [[], []];
	await streamWavBlobPcm(blob, { onChunk: channels => channels.forEach((channel, index) => actual[index].push(...channel)) });
	for (let channel = 0; channel < 2; channel++) {
		let error = 0;
		for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(actual[channel][frame] - reference[channel][frame]));
		expect(error).toBeLessThan(.000001);
	}
});
