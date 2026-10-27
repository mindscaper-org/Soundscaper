/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	verifyOperatingSystemCodecCapabilities,
	type OperatingSystemCodecCanaryRequest,
	type OperatingSystemCodecCanaryRunner,
} from '../desktop/os-codec-capability-adapter.ts';
import {
	createOperatingSystemDesktopCodecProvider,
	type DesktopCodecCapability,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';

const MP3 = audioCapability('windows-media-foundation-decode-mp3-mp3-default-f32-48000hz-2ch', 'decode', 'mp3', 'mp3', null, 'f32');
const AAC = audioCapability('apple-audiotoolbox-avfoundation-encode-m4a-aac-lc-f32p-48000hz-2ch', 'encode', 'm4a', 'aac', 'lc', 'f32p');

test('Linux is unavailable without invoking a canary and macOS x64 is rejected', async () => {
	let calls = 0;
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'linux-arm64', osVersion: '6.14.0', candidates: [{ capability: MP3 }],
		runner: { run: () => { calls += 1; return Promise.reject(new Error('must not run')); } },
	});
	assert.equal(result.status, 'unavailable');
	assert.equal(result.unavailableReason, 'linux-no-system-codec-provider');
	assert.equal(result.providerOptions.canaryVerifiedCapabilities.length, 0);
	assert.equal(result.observations.length, 0);
	assert.equal(calls, 0);
	await assert.rejects(() => verifyOperatingSystemCodecCapabilities({
		target: 'mac-x64' as 'mac-arm64', osVersion: '15.4', candidates: [], runner: null,
	}), /target/iu);
});

test('Windows Media Foundation admits only an exact echoed canary tuple', async () => {
	const requests: OperatingSystemCodecCanaryRequest[] = [];
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'win-x64', osVersion: '10.0.26100', candidates: [{ capability: MP3 }],
		runner: runner((request) => {
			requests.push(request);
			return passed(request, '11'.repeat(32));
		}),
	});
	assert.equal(result.status, 'available');
	assert.equal(result.unavailableReason, null);
	assert.equal(requests[0]?.implementation, 'windows-media-foundation');
	assert.equal(requests[0]?.target, 'win-x64');
	assert.equal(requests[0]?.capability, result.providerOptions.canaryVerifiedCapabilities[0]?.capability);
	assert.equal(Object.isFrozen(requests[0]), true);
	assert.equal(Object.isFrozen(requests[0]?.capability), true);
	assert.match(result.providerOptions.capabilityGeneration, /^os-canary-[a-f0-9]{64}$/u);

	const provider = createOperatingSystemDesktopCodecProvider(result.providerOptions);
	assert.equal((await provider.preflight(asOperation(MP3, { sampleRate: 48_000, channelCount: 2 }), {})).disposition, 'supported');
	assert.equal(provider.resolve(asOperation(MP3, { sampleRate: 48_000, channelCount: 2 }))?.implementation,
		'windows-media-foundation');
	assert.equal((await provider.preflight(asOperation(MP3, {
		profile: 'high', sampleRate: 48_000, channelCount: 2,
	}), {})).disposition, 'unsupported');
	assert.equal((await provider.preflight(asOperation(MP3, {
		sampleRate: 48_000, channelCount: 3,
	}), {})).disposition, 'unsupported');
});

test('mac-arm64 routes its audio canary through the reviewed Apple audio framework', async () => {
	const implementations: string[] = [];
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'mac-arm64', osVersion: '15.4',
		candidates: [{ capability: AAC }],
		runner: runner((request) => {
			implementations.push(request.implementation);
			return passed(request, '22'.repeat(32));
		}),
	});
	assert.deepEqual(implementations, [
		'apple-audiotoolbox-avfoundation',
	]);
	assert.equal(result.providerOptions.canaryVerifiedCapabilities.length, 1);
	const provider = createOperatingSystemDesktopCodecProvider(result.providerOptions);
	assert.equal(provider.resolve(asOperation(AAC, { sampleRate: 48_000, channelCount: 2 }))?.implementation,
		'apple-audiotoolbox-avfoundation');
});

test('no injected native canary means no OS codec claim', async () => {
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'win-arm64', osVersion: '10.0.26100', candidates: [{ capability: MP3 }], runner: null,
	});
	assert.equal(result.status, 'unavailable');
	assert.equal(result.unavailableReason, 'native-canary-adapter-unavailable');
	assert.deepEqual(result.providerOptions.canaryVerifiedCapabilities, []);
	assert.deepEqual(result.observations, [{
		capabilityId: MP3.id, disposition: 'unavailable', reason: 'canary-adapter-unavailable',
	}]);
});

test('a throwing native runner withdraws only its failed tuple', async () => {
	const result = await verifyOperatingSystemCodecCapabilities({
		target: 'win-x64', osVersion: '10.0.26100',
		candidates: [
			{ capability: MP3 },
			{ capability: { ...MP3, id: 'wmf-mp3-runner-failed' } },
		],
		runner: runner((request) => {
			if (request.capability.id === MP3.id) return passed(request, '44'.repeat(32));
			throw new Error('private native runtime failure');
		}),
	});
	assert.equal(result.status, 'available');
	assert.deepEqual(result.providerOptions.canaryVerifiedCapabilities.map(({ capability }) => capability.id), [MP3.id]);
	assert.deepEqual(result.observations.map(({ disposition, reason }) => ({ disposition, reason })), [
		{ disposition: 'verified', reason: null },
		{ disposition: 'unavailable', reason: 'canary-failed' },
	]);
});

test('typed native refusal and timeout remain unavailable rather than advertised', async () => {
	const refused = await verifyOperatingSystemCodecCapabilities({
		target: 'mac-arm64', osVersion: '15.4', candidates: [{ capability: AAC }],
		runner: { run: () => Promise.resolve({
			contractVersion: 1, status: 'unavailable', reason: 'tuple-unsupported',
		}) },
	});
	assert.equal(refused.status, 'unavailable');
	assert.deepEqual(refused.observations, [{
		capabilityId: AAC.id, disposition: 'unavailable', reason: 'tuple-unsupported',
	}]);

	const timedOut = await verifyOperatingSystemCodecCapabilities({
		target: 'mac-arm64', osVersion: '15.4', candidates: [{ capability: AAC }],
		maximumDurationMs: 5,
		runner: { run: () => new Promise(() => {}) },
	});
	assert.equal(timedOut.status, 'unavailable');
	assert.equal(timedOut.observations[0]?.reason, 'canary-timeout');
});

test('verification identity binds exact tuples and result digests into immutable output', async () => {
	const collect = (resultDigest: string) => verifyOperatingSystemCodecCapabilities({
		target: 'win-x64' as const, osVersion: '10.0.26100', candidates: [{ capability: MP3 }],
		runner: runner((request) => passed(request, resultDigest)),
	});
	const first = await collect('88'.repeat(32));
	const repeated = await collect('88'.repeat(32));
	const changed = await collect('99'.repeat(32));
	assert.equal(first.providerOptions.capabilityGeneration, repeated.providerOptions.capabilityGeneration);
	assert.notEqual(first.providerOptions.capabilityGeneration, changed.providerOptions.capabilityGeneration);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(Object.isFrozen(first.providerOptions), true);
	assert.equal(Object.isFrozen(first.observations), true);
	assert.equal(Object.isFrozen(first.providerOptions.canaryVerifiedCapabilities), true);
	assert.throws(() => {
		(first.providerOptions as { osVersion: string }).osVersion = 'changed';
	}, TypeError);
});

function runner(
	answer: (request: OperatingSystemCodecCanaryRequest) => unknown,
): OperatingSystemCodecCanaryRunner {
	return { run: (request) => Promise.resolve(answer(request)) };
}

function passed(request: OperatingSystemCodecCanaryRequest, resultDigest: string) {
	return {
		contractVersion: 1 as const, status: 'passed' as const,
		target: request.target, osVersion: request.osVersion,
		capabilityId: request.capability.id, capabilityDigest: request.capabilityDigest,
		implementation: request.implementation, nativeApiReached: true as const,
		exactTuplePassed: true as const, resultDigest,
	};
}

function audioCapability(
	id: string, direction: 'encode' | 'decode', container: string, codec: string,
	profile: string | null, sampleFormat: string,
): DesktopCodecCapability {
	return Object.freeze({
		id, direction, mediaKind: 'audio', container, codec, profile, sampleFormat,
		pixelFormat: null,
		sampleRate: 48_000,
		channelCount: 2,
		width: null, height: null,
	});
}

function asOperation(
	capability: DesktopCodecCapability, overrides: Partial<DesktopCodecOperation>,
): DesktopCodecOperation {
	return Object.freeze({
		direction: capability.direction, mediaKind: capability.mediaKind,
		container: capability.container, codec: capability.codec, profile: capability.profile,
		sampleFormat: capability.sampleFormat, pixelFormat: capability.pixelFormat,
		sampleRate: typeof capability.sampleRate === 'number' ? capability.sampleRate : null,
		channelCount: typeof capability.channelCount === 'number' ? capability.channelCount : null,
		width: typeof capability.width === 'number' ? capability.width : null,
		height: typeof capability.height === 'number' ? capability.height : null,
		...overrides,
	});
}
