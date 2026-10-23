/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

async function installNativeOriginalBridge(page, native, read) {
	await installDesktopSpeedWarmupManifest(page);
	await page.exposeBinding('__nativeFileIpc', async (_source, channel, request) => await native.invoke(channel,
		channel === 'soundscaper:v1:save:chunk' ? { ...request, bytes: Uint8Array.from(request.bytes) } : request,
	));
	await page.exposeBinding('__nativeFileFetch', async (_source, url, init) => {
		const response = await read(url, init);
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

for (const phase of ['header', 'metadata']) test(`Cancel releases native pending ${phase} metadata reads before a fresh File Import`, async ({ page }) => {
	const file = new File([encodeWav([new Float32Array(4800).fill(.2)], { sampleRate: 48_000 })], 'Metadata.wav');
	const native = await nativeOriginalImportFixture(file); let held = false; let released = false; let resume;
	const pending = new Promise(resolve => { resume = resolve; });
	try {
		await installNativeOriginalBridge(page, native, async (url, init) => {
			const response = await native.fetch(url, init);
			const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range'));
			if (!held && (phase === 'header' || Number(range[2]) - Number(range[1]) + 1 > 12)) {
				held = true; await pending;
			}
			return response;
		});
		const editor = await bootEditor(page, '/embed/en/'); await chooseFileAction(page, editor, 'Import');
		await expect.poll(() => held).toBe(true);
		const progress = editor.locator('[data-editor-task-progress="import"]');
		await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(progress).toHaveCount(0); expect(released).toBe(false);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		released = true; resume(); await page.evaluate(() => new Promise(requestAnimationFrame));
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		await expect(editor.getByRole('group', { name: /^Metadata\.wav clip,/u })).toHaveCount(0);
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	} finally { resume(); await native.close(); }
});
