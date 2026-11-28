/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activateOfflineShell, handleOfflineShellFetch, installOfflineShell } from '../scripts/lib/offline-service-worker.mjs';
import { asset, MemoryCacheStorage, response, shellCacheName, shellConfiguration, shellResponse } from './helpers/offline-shell-fixtures.js';

const origin = 'https://soundscaper.test';
const workerPath = '/tracktion/tracktion-project-worker.js';
const corePath = '/tracktion/edit-core.js';
const wasmPath = '/tracktion/edit-core.wasm';
const contents = 'verified engine';
const stale = 'previous engine';

for (const outcome of ['unchanged', 'changed WASM', 'stale response', 'offline', 'missing WASM', 'cache write failure'] as const) {
	test(`an offline shell update preserves a reusable Tracktion engine as a group (${outcome})`, async (context) => {
		const changed = outcome === 'changed WASM' || outcome === 'stale response' || outcome === 'offline';
		const complete = outcome === 'unchanged' || outcome === 'changed WASM';
		const unrelated = '/assets/deferred.js';
		const bodies = new Map([
			[workerPath, 'worker code'], [corePath, 'core code'], [wasmPath, 'older WASM'],
			[unrelated, 'unrelated code'],
		]);
		const previous = shellConfiguration('4', Array.from(bodies, ([url, body]) => asset(url, body)));
		const configuration = shellConfiguration('5', Array.from(bodies, ([url, body]) =>
			asset(url, url === wasmPath && changed ? 'newer WASM' : body)));
		const cacheStorage = new MemoryCacheStorage();
		const previousName = await installOfflineShell({ configuration: previous, cacheStorage, fetchImpl: async (url: string) => {
			assert.ok(previous.installUrls.includes(url));
			return shellResponse(url);
		} });
		const oldCache = await cacheStorage.open(previousName);
		for (const path of [workerPath, corePath, wasmPath]) assert.equal(await oldCache.match(path), undefined);
		for (const [url, body] of bodies) {
			if (url === wasmPath && outcome === 'missing WASM') continue;
			const reply = await handleOfflineShellFetch({
				configuration: previous, cacheStorage, origin, request: new Request(new URL(url, origin)),
				fetchImpl: async () => response(body),
			});
			assert.equal(await reply.text(), body);
		}
		const nextName = shellCacheName(configuration.releaseId);
		let quotaInjected = false;
		if (outcome === 'cache write failure') {
			const open = cacheStorage.open.bind(cacheStorage);
			let wrapped: Awaited<ReturnType<typeof open>> | undefined;
			context.mock.method(cacheStorage, 'open', async (name: string) => {
				const cache = await open(name);
				if (name === nextName && cache !== wrapped) {
					wrapped = cache;
					const put = cache.put.bind(cache);
					context.mock.method(cache, 'put', async (key: string, value: Response) => {
						if (key === wasmPath) {
							quotaInjected = true;
							throw new DOMException('Quota exceeded', 'QuotaExceededError');
						}
						await put(key, value);
					});
				}
				return cache;
			});
		}
		const fetched: string[] = [];
		const offline = () => Promise.reject(new Error('The network is unavailable'));
		const fetchImpl = async (url: string, options: RequestInit) => {
			fetched.push(url);
			assert.equal(url, wasmPath);
			assert.equal(options.cache, 'reload');
			assert.ok(options.signal instanceof AbortSignal);
			if (outcome === 'offline') return await offline();
			return response(outcome === 'changed WASM' ? 'newer WASM' : 'older WASM');
		};
		assert.equal(await installOfflineShell({ configuration, cacheStorage, fetchImpl }), nextName);
		assert.deepEqual(fetched, changed ? [wasmPath] : []);
		assert.equal(quotaInjected, outcome === 'cache write failure');
		await activateOfflineShell({ configuration, cacheStorage, clients: { claim: async () => undefined } });
		assert.deepEqual(await cacheStorage.keys(), [nextName]);
		const nextCache = await cacheStorage.open(nextName);
		assert.equal(await (await nextCache.match('/en/'))?.text(), 'root shell');
		assert.equal(await nextCache.match(unrelated), undefined);
		for (const path of [workerPath, corePath, wasmPath]) {
			const saved = await nextCache.match(path);
			const expected = changed && path === wasmPath ? 'newer WASM' : bodies.get(path);
			assert.equal(await saved?.text(), complete ? expected : undefined, path);
			if (!complete) continue;
			const reply = await handleOfflineShellFetch({
				configuration, cacheStorage, origin, request: new Request(new URL(path, origin)), fetchImpl: offline,
			});
			assert.equal(await reply.text(), expected);
		}
	});
}

for (const path of [workerPath, corePath, wasmPath]) test(`Tracktion reloads ${path} until verified bytes are cached`, async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('2', [asset(path, contents)]);
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	const fetches: [string, RequestCache | undefined][] = [];
	let recovered = false;
	const fetchImpl = async (url: string, options: RequestInit) => {
		fetches.push([url, options.cache]);
		return response(recovered && options.cache === 'reload' ? contents : stale);
	};
	const load = (url: string) => handleOfflineShellFetch({ configuration, cacheStorage, origin, fetchImpl, request: new Request(new URL(url, origin)) });
	const withQuery = `${path}?old=1`;
	await assert.rejects(load(withQuery), /SHA-256 mismatch/u);
	assert.equal(await cache.match(path), undefined);
	recovered = true;
	assert.equal(await (await load(path)).text(), contents);
	assert.equal(await (await cache.match(path))?.text(), contents);
	assert.equal(await cache.match(withQuery), undefined);
	recovered = false;
	assert.equal(await (await load(withQuery)).text(), contents);
	assert.deepEqual(fetches, [[path, 'reload'], [path, 'reload']]);
});

for (const [productId, path] of [['framescaper', workerPath], ['framescaper', wasmPath], ['soundscaper', '/tracktion/unrelated.js']]) {
	test(`${productId} keeps the normal HTTP cache for ${path}`, async () => {
		const configuration = shellConfiguration('3', [asset(path, contents)], { productId });
		const reply = await handleOfflineShellFetch({
			configuration, cacheStorage: new MemoryCacheStorage(), origin, request: new Request(new URL(path, origin)),
			fetchImpl: async (url: string, options: RequestInit) => {
				assert.equal(url, path);
				assert.equal(options.cache, 'default');
				return response(contents);
			},
		});
		assert.equal(await reply.text(), contents);
	});
}
