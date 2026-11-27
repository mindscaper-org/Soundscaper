/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activateOfflineShell, installOfflineShell } from '../scripts/lib/offline-shell-worker.mjs';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { MemoryCacheStorage, response, shellCacheName, shellConfiguration, shellResponse } from './helpers/offline-shell-fixtures.js';

test('activation retires old shell caches only after the complete cache marker exists', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('e'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('f');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url: string) => shellResponse(url),
	});
	let claims = 0;

	await activateOfflineShell({
		configuration,
		cacheStorage,
		clients: { claim: async () => { claims += 1; } },
	});

	assert.equal(claims, 1);
	assert.deepEqual(await cacheStorage.keys(), [shellCacheName(configuration.releaseId)]);
	assert.equal(cacheStorage.events.at(-1), `delete:${priorName}`);
});

test('a failed client takeover preserves the prior complete shell', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('2'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('3');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url: string) => shellResponse(url),
	});

	await assert.rejects(
		() => activateOfflineShell({
			configuration,
			cacheStorage,
			clients: { claim: async () => { throw new Error('client takeover failed'); } },
		}),
		/client takeover failed/u,
	);

	assert.deepEqual(await cacheStorage.keys(), [priorName, shellCacheName(configuration.releaseId)]);
});

test('Soundscaper can complete activation when a Tracktion worker delays client takeover', async (context) => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('a'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('b');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url: string) => shellResponse(url),
	});
	const started = deferred<void>();
	const claim = deferred<void>();
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const activation = activateOfflineShell({
		configuration,
		cacheStorage,
		clients: { claim: () => { started.resolve(); return claim.promise; } },
	});
	await started.promise;
	assert.equal(await remainsPending(activation), true);
	context.mock.timers.tick(1_000);
	assert.equal(await remainsPending(activation), false);
	await activation;

	assert.deepEqual(await cacheStorage.keys(), [priorName, shellCacheName(configuration.releaseId)]);
	claim.reject(new Error('The client disappeared before it claimed the new worker'));
});
