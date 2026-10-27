/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createOperatingSystemCodecNativeCanaryRunner,
	type OperatingSystemCodecNativeHostAdapter,
} from '../desktop/os-codec-native-canary-runner.ts';
import type {
	OperatingSystemCodecCanaryRequest,
	OperatingSystemCodecCanaryResult,
} from '../desktop/os-codec-capability-adapter.ts';
import type { DesktopCodecCapability, DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.ts';

const WINDOWS_AUDIO = audioCapability('windows-media-foundation-decode-mp3-mp3-default-f32-48000hz-2ch', 'decode', 'mp3', 'mp3', null, 'f32');
const APPLE_AUDIO = audioCapability('apple-audiotoolbox-avfoundation-encode-m4a-aac-lc-f32p-48000hz-2ch', 'encode', 'm4a', 'aac', 'lc', 'f32p');

test('Windows x64 and ARM64 invoke only the injected Media Foundation native host', async () => {
	const received: OperatingSystemCodecCanaryRequest[] = [];
	const signals: AbortSignal[] = [];
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((request, signal) => {
		received.push(request);
		signals.push(signal);
		return passed(request, '11'.repeat(32));
	}));
	for (const target of ['win-x64', 'win-arm64'] as const) {
		const result = await runner.run(canaryRequest({
			target, implementation: 'windows-media-foundation', capability: WINDOWS_AUDIO,
		}), new AbortController().signal) as OperatingSystemCodecCanaryResult;
		assert.equal(result.status, 'passed');
		assert.equal(result.status === 'passed' && result.target, target);
	}
	assert.deepEqual(received.map(({ target }) => target), ['win-x64', 'win-arm64']);
	assert.deepEqual(received.map(({ implementation }) => implementation), [
		'windows-media-foundation', 'windows-media-foundation',
	]);
	assert.deepEqual(Object.keys(received[0] ?? {}).sort(), [
		'capability', 'capabilityDigest', 'contractVersion', 'implementation',
		'maximumDurationMs', 'osVersion', 'target',
	]);
	assert.equal(received.every(Object.isFrozen), true);
	assert.equal(received.every(({ capability }) => Object.isFrozen(capability)), true);
	assert.equal(signals.every((signal) => signal instanceof AbortSignal), true);
});

test('macOS ARM64 binds its audio tuple to the reviewed Apple audio framework', async () => {
	const implementations: string[] = [];
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((request) => {
		implementations.push(request.implementation);
		return passed(request, '22'.repeat(32));
	}));
	await runner.run(canaryRequest({
		target: 'mac-arm64', implementation: 'apple-audiotoolbox-avfoundation', capability: APPLE_AUDIO,
	}), new AbortController().signal);
	assert.deepEqual(implementations, [
		'apple-audiotoolbox-avfoundation',
	]);
});

test('the native invocation is independently bounded and aborts its injected host signal', async () => {
	const capture: { signal: AbortSignal | null } = { signal: null };
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((_request, signal) => {
		capture.signal = signal;
		return new Promise(() => {});
	}));
	const started = performance.now();
	await assert.rejects(() => runner.run(canaryRequest({
		target: 'win-x64', implementation: 'windows-media-foundation', capability: WINDOWS_AUDIO,
		maximumDurationMs: 10,
	}), new AbortController().signal), /timed out/iu);
	assert.ok(performance.now() - started < 1_000);
	assert.equal(capture.signal?.aborted, true);
});

test('caller cancellation reaches the native host even when it ignores cancellation', async () => {
	const caller = new AbortController();
	const capture: { signal: AbortSignal | null } = { signal: null };
	let started!: () => void;
	const invoked = new Promise<void>((resolve) => { started = resolve; });
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((_request, signal) => {
		capture.signal = signal;
		started();
		return new Promise(() => {});
	}));
	const pending = runner.run(canaryRequest({
		target: 'win-arm64', implementation: 'windows-media-foundation', capability: WINDOWS_AUDIO,
		maximumDurationMs: 1_000,
	}), caller.signal);
	await invoked;
	caller.abort(new Error('caller cancelled OS canary'));
	await assert.rejects(() => pending, /caller cancelled OS canary/iu);
	assert.equal(capture.signal?.aborted, true);
});

test('the native-host seam exposes no subprocess, shell, argv, or filesystem path authority', async () => {
	const source = await readFile(new URL('../desktop/os-codec-native-canary-runner.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bshell\s*:/u);
	assert.doesNotMatch(source, /executablePath|inputPath|outputPath|\bargv\b/u);
});

function adapter(
	invoke: OperatingSystemCodecNativeHostAdapter['runCanary'],
): OperatingSystemCodecNativeHostAdapter {
	return { runCanary: (request, signal) => Promise.resolve(invoke(request, signal)) };
}

function canaryRequest(options: Readonly<{
	readonly target: DesktopCodecTarget;
	readonly implementation: OperatingSystemCodecCanaryRequest['implementation'];
	readonly capability: DesktopCodecCapability;
	readonly maximumDurationMs?: number;
}>): OperatingSystemCodecCanaryRequest {
	return {
		contractVersion: 1,
		target: options.target,
		osVersion: options.target.startsWith('win-') ? '10.0.26100' : '15.4',
		implementation: options.implementation,
		capability: options.capability,
		capabilityDigest: createHash('sha256').update(JSON.stringify(options.capability), 'utf8').digest('hex'),
		maximumDurationMs: options.maximumDurationMs ?? 500,
	};
}

function passed(
	request: OperatingSystemCodecCanaryRequest,
	resultDigest: string,
): Extract<OperatingSystemCodecCanaryResult, { readonly status: 'passed' }> {
	return {
		contractVersion: 1,
		status: 'passed',
		target: request.target,
		osVersion: request.osVersion,
		capabilityId: request.capability.id,
		capabilityDigest: request.capabilityDigest,
		implementation: request.implementation,
		nativeApiReached: true,
		exactTuplePassed: true,
		resultDigest,
	};
}

function audioCapability(
	id: string, direction: 'encode' | 'decode', container: string, codec: string,
	profile: string | null, sampleFormat: string,
): DesktopCodecCapability {
	return {
		id, direction, mediaKind: 'audio', container, codec, profile, sampleFormat,
		pixelFormat: null,
		sampleRate: 48_000,
		channelCount: 2,
		width: null, height: null,
	};
}
