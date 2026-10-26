/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createExternalFfmpegDesktopCodecProvider,
	createOperatingSystemDesktopCodecProvider,
	type DesktopCodecCapability,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';

const VIDEO_RANGE = Object.freeze({ minimum: 16, maximum: 8_192, multipleOf: 2 });
const AV1_ENCODE = operation({
	direction: 'encode', mediaKind: 'video', container: 'webm', codec: 'av1',
	profile: 'main', pixelFormat: 'yuv420p', width: 1_920, height: 1_080,
});




test('OS providers expose only exact canary-verified tuples and Linux stays unavailable', async () => {
	const capability = videoCapability('wmf-h264-canary', 'h264', 'main', 'nv12');
	const windows = createOperatingSystemDesktopCodecProvider({
		target: 'win-x64', osVersion: '10.0.26100', capabilityGeneration: 'canary-17',
		canaryVerifiedCapabilities: [{ capability, implementation: 'media-foundation-h264' }],
	});
	const exact = operation({
		direction: 'decode', mediaKind: 'video', container: 'mp4', codec: 'h264',
		profile: 'main', pixelFormat: 'nv12', width: 1_920, height: 1_080,
	});
	assert.equal((await windows.preflight(exact, {})).disposition, 'supported');
	assert.equal(windows.resolve(exact)?.implementation, 'media-foundation-h264');
	assert.equal((await windows.preflight(operation({ ...exact, profile: 'high' }), {})).disposition, 'unsupported');
	assert.equal((await windows.preflight(operation({ ...exact, width: 8_194 }), {})).disposition, 'unsupported');

	const linux = createOperatingSystemDesktopCodecProvider({
		target: 'linux-arm64', osVersion: '6.14', capabilityGeneration: 'canary-linux',
		canaryVerifiedCapabilities: [{ capability, implementation: 'must-not-leak' }],
	});
	assert.equal((await linux.preflight(exact, {})).disposition, 'unavailable');
	assert.equal(linux.capabilities.length, 0);
	assert.equal(linux.resolve(exact), null);
});

test('unknown audio decode geometry may select a ranged capability but encode remains exact', async () => {
	const range = Object.freeze({ minimum: 8_000, maximum: 192_000, multipleOf: 1 });
	const capability: DesktopCodecCapability = {
		id: 'wmf-mp3-source-geometry', direction: 'decode', mediaKind: 'audio',
		container: 'mp3', codec: 'mp3', profile: null, sampleFormat: 'f32', pixelFormat: null,
		sampleRate: range, channelCount: { minimum: 1, maximum: 2, multipleOf: 1 },
		width: null, height: null,
	};
	const provider = createOperatingSystemDesktopCodecProvider({
		target: 'win-x64', osVersion: '10.0.26100', capabilityGeneration: 'canary-audio',
		canaryVerifiedCapabilities: [{ capability, implementation: 'media-foundation-mp3' }],
	});
	const unresolved = operation({
		direction: capability.direction, mediaKind: capability.mediaKind,
		container: capability.container, codec: capability.codec, profile: capability.profile,
		sampleFormat: capability.sampleFormat, pixelFormat: capability.pixelFormat,
		sampleRate: null, channelCount: null, width: null, height: null,
	});
	assert.equal((await provider.preflight(unresolved, {})).disposition, 'supported');
	assert.equal((await provider.preflight({ ...unresolved, direction: 'encode' }, {})).disposition, 'unsupported');
});

test('external FFmpeg requires both an exact tuple and every probed implementation', async () => {
	const verified = [{
		capability: { ...videoCapability('ffmpeg-av1', 'av1', 'main', 'yuv420p'), direction: 'encode' as const },
		implementation: 'libsvtav1',
		requires: { encoders: ['libsvtav1'], muxers: ['webm'], filters: ['scale'] },
	}] as const;
	const provider = createExternalFfmpegDesktopCodecProvider({
		target: 'mac-arm64', version: '9.0.1', capabilityGeneration: 'probe-sha256-abc',
		capabilitySets: {
			encoders: ['libsvtav1'], decoders: ['dav1d'], muxers: ['webm'],
			demuxers: ['webm'], filters: ['scale'],
		},
		verifiedCapabilities: verified,
	});
	const exact = operation({ ...AV1_ENCODE });
	assert.equal((await provider.preflight(exact, {})).disposition, 'supported');
	assert.equal(provider.resolve(exact)?.implementation, 'libsvtav1');
	assert.equal((await provider.preflight(operation({ ...exact, pixelFormat: 'yuv444p' }), {})).disposition, 'unsupported');

	const missingEncoder = createExternalFfmpegDesktopCodecProvider({
		target: 'mac-arm64', version: '9.0.1', capabilityGeneration: 'probe-sha256-def',
		capabilitySets: {
			encoders: ['libaom-av1'], decoders: [], muxers: ['webm'], demuxers: [], filters: ['scale'],
		},
		verifiedCapabilities: verified,
	});
	assert.equal((await missingEncoder.preflight(exact, {})).disposition, 'unsupported');
	assert.equal(missingEncoder.capabilities.length, 0);
});

test('provider identities and admitted capabilities are immutable copies', () => {
	const capabilities = [videoCapability('apple-hevc', 'hevc', 'main', 'p010le')];
	const provider = createOperatingSystemDesktopCodecProvider({
		target: 'mac-arm64', osVersion: '15.4', capabilityGeneration: 'canary-88',
		canaryVerifiedCapabilities: [{ capability: capabilities[0]!, implementation: 'video-toolbox-hevc' }],
	});
	capabilities.splice(0);
	assert.equal(provider.kind, 'operating-system');
	assert.equal(provider.id, 'operating-system-codecs-mac-arm64');
	assert.equal(provider.implementation, 'apple-audiotoolbox-avfoundation-videotoolbox');
	assert.equal(provider.version, '15.4');
	assert.equal(provider.capabilityGeneration, 'canary-88');
	assert.equal(provider.capabilities.length, 1);
	assert.equal(Object.isFrozen(provider), true);
	assert.equal(Object.isFrozen(provider.capabilities), true);
	assert.equal(Object.isFrozen(provider.capabilities[0]), true);
	assert.throws(() => {
		(provider as { version: string }).version = 'changed';
	}, TypeError);
});


function videoCapability(
	id: string, codec: string, profile: string, pixelFormat: string,
): DesktopCodecCapability {
	return {
		id, direction: 'decode', mediaKind: 'video', container: codec === 'h264' ? 'mp4' : 'webm', codec,
		profile, sampleFormat: null, pixelFormat, sampleRate: null, channelCount: null,
		width: VIDEO_RANGE, height: VIDEO_RANGE,
	};
}

function operation(overrides: Partial<DesktopCodecOperation>): DesktopCodecOperation {
	return Object.freeze({
		direction: 'decode', mediaKind: 'audio', container: 'wav', codec: 'pcm', profile: null,
		sampleFormat: null, pixelFormat: null, sampleRate: null, channelCount: null,
		width: null, height: null, ...overrides,
	});
}
