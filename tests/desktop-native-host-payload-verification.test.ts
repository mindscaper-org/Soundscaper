/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	framescaperMediaHostTargetFor,
} from '../desktop/framescaper-media-host-payload.ts';
import {
	framescaperNativeHostTargetFor,
	isMissingNativeHostPayloadError,
	nativeHostIsolationPayloads,
	nativeHostPayloadPath,
	verifyNativeHostPayload,
} from '../desktop/native-host-payload-verification.ts';
import {
	framescaperOpenFxHostTargetFor,
} from '../desktop/framescaper-openfx-host-payload.ts';

const BYTES = Buffer.from('authenticated native host');
const PAYLOAD = Object.freeze({
	path: 'native/example/prebuilt/linux-x64/bin/tool',
	byteLength: BYTES.byteLength,
	sha256: createHash('sha256').update(BYTES).digest('hex'),
});

test('media and OpenFX hosts use one exact platform-target map', () => {
	for (const select of [framescaperNativeHostTargetFor, framescaperMediaHostTargetFor, framescaperOpenFxHostTargetFor]) {
		assert.equal(select('linux', 'arm64'), 'linux-arm64');
	}
	assert.equal(framescaperNativeHostTargetFor('darwin', 'x64'), null);
});

test('payload paths preserve development containment and flatten prepared runtime inventories', () => {
	const development = Object.freeze({
		applicationRoot: '/application', packaged: false, resourcesPath: '/unused',
	});
	assert.equal(nativeHostPayloadPath(
		development, 'native/example', 'linux-x64', PAYLOAD.path, 'escaped',
	), '/application/native/example/prebuilt/linux-x64/bin/tool');
	assert.equal(nativeHostPayloadPath(
		{ ...development, packaged: true, resourcesPath: '/resources' },
		'native/example', 'linux-x64', PAYLOAD.path, 'escaped',
	), '/resources/runtime/native/example/linux-x64/tool');
	assert.equal(nativeHostPayloadPath(
		{ ...development, externalRuntimeRoot: '/prepared' },
		'native/example', 'linux-x64', PAYLOAD.path, 'escaped',
	), '/prepared/native/example/linux-x64/tool');
});

test('payload verification returns one immutable digest, size, and stable file identity snapshot', async () => {
	const calls: string[] = [];
	const descriptor = await verifyNativeHostPayload('/runtime/tool', PAYLOAD, {
		readFile: async (path) => { calls.push(`read:${path}`); return BYTES; },
		stat: async (path) => {
			calls.push(`stat:${path}`);
			return fileStat();
		},
	});
	assert.deepEqual(calls, [
		'stat:/runtime/tool',
		'read:/runtime/tool',
		'stat:/runtime/tool',
	]);
	assert.deepEqual(descriptor, {
		path: '/runtime/tool',
		byteLength: BYTES.byteLength,
		sha256: PAYLOAD.sha256,
		identity: { dev: 7, ino: 11 },
	});
	assert.equal(Object.isFrozen(descriptor), true);
	assert.equal(Object.isFrozen(descriptor.identity), true);
});

test('payload verification refuses symlinks, digest/size drift, and inspection-time replacement', async () => {
	for (const [label, bytes, observations] of [
		['symbolic link', BYTES, [fileStat({ symbolicLink: true }), fileStat({ symbolicLink: true })]],
		['digest', Buffer.from('altered native host'), [fileStat(), fileStat()]],
		['declared size', BYTES, [fileStat({ size: BYTES.byteLength + 1 }), fileStat({ size: BYTES.byteLength + 1 })]],
		['device replacement', BYTES, [fileStat(), fileStat({ dev: 8 })]],
		['inode replacement', BYTES, [fileStat(), fileStat({ ino: 12 })]],
	] as const) {
		let index = 0;
		await assert.rejects(verifyNativeHostPayload('/runtime/tool', PAYLOAD, {
			readFile: async () => bytes,
			stat: async () => observations[Math.min(index++, observations.length - 1)]!,
		}), /payload-digest-mismatch/u, label);
	}
});

test('isolation inventory order and missing-file classification are shared and exact', () => {
	const identities = nativeHostIsolationPayloads({
		launcherPayload: { ...PAYLOAD, path: 'launcher' },
		sandboxProfilePayload: { ...PAYLOAD, path: 'profile' },
		brokerPolicyPayload: { ...PAYLOAD, path: 'policy' },
		runtimeLibraryPayloads: [{ ...PAYLOAD, path: 'library-a' }, { ...PAYLOAD, path: 'library-b' }],
	});
	assert.deepEqual(identities.map(({ path }) => path), [
		'launcher', 'profile', 'policy', 'library-a', 'library-b',
	]);
	assert.equal(Object.isFrozen(identities), true);
	assert.equal(isMissingNativeHostPayloadError(Object.assign(new Error('missing'), { code: 'ENOENT' })), true);
	assert.equal(isMissingNativeHostPayloadError(Object.assign(new Error('denied'), { code: 'EACCES' })), false);
});

function fileStat(options: Readonly<{
	readonly size?: number;
	readonly dev?: number;
	readonly ino?: number;
	readonly symbolicLink?: boolean;
}> = {}) {
	return Object.freeze({
		isFile: () => true,
		isSymbolicLink: () => options.symbolicLink ?? false,
		size: options.size ?? BYTES.byteLength,
		dev: options.dev ?? 7,
		ino: options.ino ?? 11,
	});
}
