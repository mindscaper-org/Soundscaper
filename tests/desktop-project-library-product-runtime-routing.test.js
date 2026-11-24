/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	startDesktopProjectLibraryProductRuntime,
	startLoadedDesktopProjectLibraryProductRuntime,
} from '../desktop/project-library-product-runtime.js';

test('the shared desktop main has no Soundscaper project library route', async () => {
	await assert.rejects(startDesktopProjectLibraryProductRuntime({
		productId: 'soundscaper', appDataPath: '/tmp/project-library-routing-test', processId: 7,
		instanceId: 'instance-1', onLeaseLost: () => undefined, leaseTestControl: null,
	}), /requires Framescaper/u);
});

test('the Framescaper project library registers through the main preload', async () => {
	const calls = [];
	const host = {
		localHandshake: Object.freeze({ schemaFamily: 'test', schemaVersion: 1 }),
		snapshot: () => Object.freeze({ product: 'framescaper' }),
		close: async () => { calls.push('close'); },
	};
	const onLeaseLost = () => undefined;
	const owner = Object.freeze({ product: 'framescaper', processId: 7, instanceId: 'instance-1' });
	const runtime = await startLoadedDesktopProjectLibraryProductRuntime({
		appDataPath: '/tmp/project-library-routing-test',
		owner,
		onLeaseLost,
		leaseTestControl: Object.freeze({
			leaseTtlMs: 30_000,
			renewIntervalMs: 10_000,
			checkpoint: 'after-open',
		}),
		createHandshake: () => Object.freeze({ product: 'framescaper' }),
		startHost: async (options) => {
			calls.push(['start', options]);
			return host;
		},
		registerIpc: (options) => {
			calls.push(['register', options]);
			return Object.freeze({
				dispose: async () => { calls.push('dispose-registration'); },
				revokeOwner: () => undefined,
			});
		},
	});

	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], ['start', {
		appDataPath: '/tmp/project-library-routing-test',
		owner,
		handshake: { product: 'framescaper' },
		onLeaseLost,
		testControl: {
			leaseTtlMs: 30_000,
			renewIntervalMs: 10_000,
			checkpoint: 'after-open',
		},
	}]);
	assert.ok(Object.isFrozen(calls[0][1].testControl));

	const bridge = runtime.registerRendererBridge({
		handle: () => undefined,
		ownerFor: () => owner,
		removeHandler: () => undefined,
	});
	assert.equal(calls.length, 2);
	assert.equal(calls[1][0], 'register');
	assert.equal(calls[1][1].main, host);
	await bridge.dispose();
	await runtime.close();
	assert.deepEqual(calls.slice(2), ['dispose-registration', 'close']);
});
