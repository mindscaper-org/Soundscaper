/* SPDX-License-Identifier: AGPL-3.0-only */
import { installDesktopSpeedWarmupManifest } from './desktop-speed-warmup-fixture.js';

export async function installNativeOriginalBridge(page, native, read = native.fetch) {
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

