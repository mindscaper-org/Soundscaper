/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLazyDesktopAudioCodecService } from '../desktop/desktop-audio-codec-lazy-service.ts';
import { registerDesktopAudioCodecMainIpc } from '../desktop/desktop-audio-codec-main-ipc.ts';
import type { DesktopAudioCodecMainIpcService } from '../desktop/desktop-audio-codec-main-ipc.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';

function gate<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>(accept => { resolve = accept; });
	return { promise, resolve };
}
const query: DesktopAudioCodecCapabilityQuery = { schemaVersion: 2, operations: [{
	operation: 'audio-encode', format: 'flac', sampleRate: 48_000, channelCount: 1,
	settings: { compressionLevel: 5, bitDepth: 24 },
}] };
const request: DesktopAudioCodecRequest = { operation: 'audio-encode', format: 'flac',
	input: new Uint8Array(8), sampleRate: 48_000, channelCount: 1,
	settings: { compressionLevel: 5, bitDepth: 24 }, maximumOutputBytes: 8192,
};

test('registering codecs does not probe and concurrent first requests share one preparation', async () => {
	let loads = 0;
	const loaded = gate<DesktopAudioCodecMainIpcService>();
	const seen: unknown[] = [];
	const lazy = createLazyDesktopAudioCodecService(() => { loads++; return loaded.promise; });
	assert.equal(loads, 0);
	const abort = new AbortController();
	const capabilities = lazy.service.capabilities(query);
	const execute = lazy.service.execute(request, { signal: abort.signal });
	await Promise.resolve();
	assert.equal(loads, 1);
	loaded.resolve({ capabilities: async value => { seen.push(value); return 'supported'; },
		execute: async (value, options) => { seen.push(value, options.signal); return 'output'; } });
	assert.equal(await capabilities, 'supported');
	assert.equal(await execute, 'output');
	assert.deepEqual(seen, [query, request, abort.signal]);
	await lazy.dispose();
});

test('a canceled first request never probes', async () => {
	let loads = 0;
	const lazy = createLazyDesktopAudioCodecService(() => { loads++; throw new Error('must not load'); });
	const abort = new AbortController(); abort.abort(new Error('cancelled'));
	await assert.rejects(lazy.service.execute(request, { signal: abort.signal }), /cancelled/u);
	assert.equal(loads, 0);
	await lazy.dispose();
});

test('canceling one preparation waiter is prompt and does not cancel another owner', async () => {
	const loaded = gate<DesktopAudioCodecMainIpcService>();
	const lazy = createLazyDesktopAudioCodecService(() => loaded.promise);
	const abort = new AbortController();
	const execute = lazy.service.execute(request, { signal: abort.signal });
	const capability = lazy.service.capabilities(query);
	abort.abort(new Error('owner revoked'));
	await assert.rejects(execute, /owner revoked/u);
	loaded.resolve({ capabilities: async () => 'supported', execute: async () => assert.fail('canceled input executed') });
	assert.equal(await capability, 'supported');
	await lazy.dispose();
});

test('disposal never probes unused codecs and rejects subsequent requests', async () => {
	let loads = 0;
	const lazy = createLazyDesktopAudioCodecService(() => { loads++; throw new Error('must not load'); });
	await lazy.dispose();
	await assert.rejects(lazy.service.capabilities(query), /stopped/u);
	assert.equal(loads, 0);
});

test('shutdown rejects waiters immediately but drains in-flight canaries', async () => {
	const loaded = gate<DesktopAudioCodecMainIpcService>();
	const lazy = createLazyDesktopAudioCodecService(() => loaded.promise);
	const capability = lazy.service.capabilities(query);
	await Promise.resolve();
	const shutdown = lazy.dispose();
	assert.equal(lazy.dispose(), shutdown);
	await assert.rejects(capability, /stopped/u);
	let drained = false;
	void shutdown.then(() => { drained = true; });
	await Promise.resolve(); assert.equal(drained, false);
	loaded.resolve({ capabilities: async () => assert.fail('disposed input executed'), execute: async () => null });
	await shutdown;
	assert.equal(drained, true);
});

test('failed preparation remains observable and can retry on a later request', async () => {
	let loads = 0;
	const lazy = createLazyDesktopAudioCodecService(() => {
		loads++;
		if (loads === 1) return Promise.reject(new Error('probe failed'));
		return Promise.resolve({ capabilities: async () => 'supported', execute: async () => null });
	});
	await assert.rejects(lazy.service.capabilities(query), /probe failed/u);
	assert.equal(await lazy.service.capabilities(query), 'supported');
	assert.equal(loads, 2);
	await lazy.dispose();
});


test('trusted IPC validates before probing and owner revocation cancels a cold execution', async () => {
	const loaded = gate<DesktopAudioCodecMainIpcService>();
	let loads = 0;
	const started = gate<void>();
	const lazy = createLazyDesktopAudioCodecService(() => { loads++; started.resolve(); return loaded.promise; });
	const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
	const owner = {};
	const channels = { desktopAudioCodecExecute: 'codec:execute', desktopAudioCodecCancel: 'codec:cancel', desktopAudioCodecCapabilities: 'codec:capabilities' };
	const ipc = registerDesktopAudioCodecMainIpc({ channels, service: lazy.service,
		handle: (channel, listener) => { handlers.set(channel, listener); },
		removeHandler: channel => { handlers.delete(channel); }, ownerFor: () => owner });
	await assert.rejects(async () => handlers.get(channels.desktopAudioCodecCapabilities)!(null, { schemaVersion: 2, operations: [], path: '/untrusted' }), TypeError);
	assert.equal(loads, 0);
	const execute = handlers.get(channels.desktopAudioCodecExecute)!(null, {
		requestId: 'cold-request', operation: 'audio-encode', format: 'flac', input: new Uint8Array(8),
		sampleRate: 48_000, channelCount: 1, settings: { compressionLevel: 5, bitDepth: 24 }, maximumOutputBytes: 8192,
	});
	const rejected = assert.rejects(Promise.resolve(execute), /revoked/u);
	await started.promise;
	assert.equal(loads, 1);
	assert.equal(await ipc.revokeOwner(owner), true);
	await rejected;
	loaded.resolve({ capabilities: async () => null, execute: async () => assert.fail('revoked input executed') });
	await Promise.all([ipc.dispose(), lazy.dispose()]);
});
