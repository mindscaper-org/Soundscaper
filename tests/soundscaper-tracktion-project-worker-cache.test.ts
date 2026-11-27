/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleOfflineShellFetch } from '../scripts/lib/offline-service-worker.mjs';
import { asset, MemoryCacheStorage, response, shellCacheName, shellConfiguration } from './helpers/offline-shell-fixtures.js';

const origin = 'https://soundscaper.test';
const workerPath = '/tracktion/tracktion-project-worker.js';
const corePath = '/tracktion/edit-core.js';
const contents = 'verified engine';
const stale = 'previous engine';

for (const path of [workerPath, corePath]) test(`Tracktion reloads ${path} until verified bytes are cached`, async () => {
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

for (const [productId, path] of [['framescaper', workerPath], ['soundscaper', '/tracktion/unrelated.js']]) {
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
