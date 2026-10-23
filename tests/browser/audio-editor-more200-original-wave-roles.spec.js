/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../../src/common/editor/wav-pcm-chunk-reader.ts';

async function installNativeOriginalBridge(page, native) {
	await installDesktopSpeedWarmupManifest(page);
	await page.exposeBinding('__nativeFileIpc', async (_source, channel, request) => await native.invoke(channel,
		channel === 'soundscaper:v1:save:chunk' ? { ...request, bytes: Uint8Array.from(request.bytes) } : request,
	));
	await page.exposeBinding('__nativeFileFetch', async (_source, url, init) => {
		const response = await native.fetch(url, init);
		return { status: response.status, headers: [...response.headers.entries()], base64: Buffer.from(await response.arrayBuffer()).toString('base64') };
	});
	await page.addInitScript({ content: `(() => {
		const required = new Set(['getEnvironment', 'chooseFiles', 'releaseRead', 'releaseOriginalFile', 'prepareOriginalOverwrite', 'releaseSaveTarget', 'beginWrite', 'writeChunk', 'patchFinalPrefix', 'finishWrite', 'abortWrite']);
		const require = () => ({ contextBridge: { exposeInMainWorld: (name, value) => {
			Object.defineProperty(globalThis, name, { value: Object.freeze({ v1: Object.freeze(Object.fromEntries(Object.entries(value.v1).filter(([key]) => required.has(key)))) }) });
		} }, ipcRenderer: {
			invoke: async (channel, value) => {
				const request = channel === 'soundscaper:v1:save:chunk' ? { ...value, bytes: [...value.bytes] } : value;
				const result = await globalThis.__nativeFileIpc(channel, request);
				if (channel === 'soundscaper:v1:original-file:prepare-overwrite') globalThis.__nativePrepareReturns += 1;
				return result;
			}, send: () => {}, on: () => {}, removeListener: () => {},
		} });
		globalThis.__nativePrepareReturns = 0;
		const originalFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (!url.startsWith('soundscaper-app:')) return originalFetch(input, init);
			const result = await globalThis.__nativeFileFetch(url, { method: init?.method ?? 'GET', headers: [...new Headers(init?.headers).entries()] });
			return new Response(Uint8Array.from(atob(result.base64), character => character.charCodeAt(0)), { status: result.status, headers: result.headers });
		};
		${native.preloadSource}
	})();` });
}

for (const channelMask of [5, 9, 3]) test(`Original WAV retains declared channel roles ${channelMask}`, async ({ page }) => {
	const samples = [Float32Array.from({ length: 2400 }, () => .125), Float32Array.from({ length: 2400 }, () => -.0625)];
	const bytes = encodeWav(samples, { sampleRate: 48000, bitDepth: 20, channelMask, dither: false });
	const file = new File([new Uint8Array(bytes).buffer], 'Channel roles.wav', { type: 'audio/wav' });
	const before = await inspectWavBlobPcm(file); expect(before.channelMask).toBe(channelMask);
	const native = await nativeOriginalImportFixture(file);
	try {
		await installNativeOriginalBridge(page, native); const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Import'); await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		const menu = await openNestedCommandMenu(page, editor, 'File', []);
		const overwrite = menu.getByRole('menuitem', { name: 'Overwrite Channel roles.wav', exact: true });
		if (channelMask !== 3) {
			await expect(menu.getByRole('menuitem', { name: 'Overwrite original file', exact: true })).toBeDisabled();
			expect(native.prepared).toHaveLength(0); expect(native.completed).toHaveLength(0);
			expect(new Uint8Array(await native.savedBytes())).toEqual(new Uint8Array(await file.arrayBuffer()));
		} else {
			await expect(overwrite).toBeEnabled(); await overwrite.click();
			await expect.poll(() => native.completed.length).toBe(1);
		}
		const output = new Blob([new Uint8Array(await native.savedBytes()).buffer]);
		const descriptor = await inspectWavBlobPcm(output);
		const decoded = await createWavBlobPcmChunkReader(output, { descriptor }).readChunk(0);
		expect(Math.abs(decoded.channels[0][1200] - .125)).toBeLessThan(.00001);
		expect(Math.abs(decoded.channels[1][1200] + .0625)).toBeLessThan(.00001);
		expect(descriptor.channelMask).toBe(channelMask);
		expect(descriptor.frameCount).toBe(2400);
	} finally { await native.close(); }
});
