/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleOfflineShellFetch, installOfflineShell } from '../scripts/lib/offline-service-worker.mjs';
import { asset, MemoryCacheStorage, response, shellCacheName, shellConfiguration, shellResponse } from './helpers/offline-shell-fixtures.js';

test('Tracktion worklet retries retain a single canonical verified offline cache entry', async () => {
	const origin = 'https://soundscaper.test';
	const path = '/tracktion/tracktion-audio-worklet.js';
	const unrelated = '/assets/deferred.js';
	const contents = 'worklet code';
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('1', [asset(path, contents), asset(unrelated, contents)]);
	await installOfflineShell({ configuration, cacheStorage, fetchImpl: async (url: string) => shellResponse(url) });
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	const retry = '?retry=12345678-1234-4123-8123-123456789abc';
	const fetches: string[] = [];
	const fromNetwork = async (url: string) => { fetches.push(url); return response(contents); };
	const load = (url: string, fetchImpl: (url: string) => Promise<Response>) => handleOfflineShellFetch({
		configuration, cacheStorage, request: new Request(new URL(url, origin)), origin, fetchImpl,
	});

	assert.equal(await (await load(path + retry, fromNetwork)).text(), contents);
	assert.deepEqual(fetches, [path + retry]);
	assert.equal(await (await cache.match(path))?.text(), contents);
	assert.equal(await cache.match(path + retry), undefined);
	assert.equal(await (await load(path + retry, () => Promise.reject(new TypeError('offline')))).text(), contents);

	assert.equal(await (await load(unrelated + retry, fromNetwork)).text(), contents);
	assert.deepEqual(fetches, [path + retry, unrelated]);
	await cache.put(path, response('content gone'));
	await assert.rejects(load(path + retry, async () => response('content gone')), /SHA-256 mismatch/u);
	assert.equal(await cache.match(path), undefined);
});
