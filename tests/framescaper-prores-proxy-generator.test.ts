/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeProResProxyCandidateObserver as createObserver,
} from '../src/framescaper/editor-native-prores-proxy-generator.ts';

type Data = Record<string, unknown>;

const BRIDGE_REQUIRED = Object.freeze(['snapshot', 'control', 'reorder', 'remove']);
const PROXY_METHODS = Object.freeze([
	'enqueue', 'selectRoot', 'revalidateRoot',
	'claimProxyOutput', 'readProxyOutput', 'releaseProxyOutput',
]);

const TIMING_PROBE = Object.freeze({ id: 'helper-probe', probe: async () => null });

function bridge(): Data {
	return Object.fromEntries(
		[...BRIDGE_REQUIRED, ...PROXY_METHODS].map((method) => [method, async () => null]),
	);
}

function scope(services: Data = bridge()): Data {
	return { framescaperDesktop: { v1: { nativeServices: services } } };
}

function getProject(): Data {
	return { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project-1', revision: 1 };
}

function observer(overrides: Data = {}): unknown {
	return createObserver({
		profile: {},
		getProject,
		scope: scope(),
		composition: { runtime: {}, helperTimingProbe: TIMING_PROBE },
		...overrides,
	} as never);
}

test('an observer is composed when a proxy bridge and a timing probe are both present', () => {
	assert.notEqual(observer(), null);
});

test('an observer declines when no desktop bridge is reachable from its scope', () => {
	assert.equal(observer({ scope: {} }), null);
});

test('an observer declines when the bridge lacks any proxy execution port', () => {
	for (const method of PROXY_METHODS) {
		const partial = bridge();
		delete partial[method];
		assert.equal(
			observer({ scope: scope(partial) }),
			null,
			`a bridge missing ${method} cannot generate a proxy`,
		);
	}
});

test('an observer declines when no timing probe can measure the source', () => {
	assert.equal(
		observer({ composition: { runtime: {} } }),
		null,
		'a proxy that cannot be timed must not be offered',
	);
});
