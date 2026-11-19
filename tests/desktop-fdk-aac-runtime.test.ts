/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ADTS, MP4, BufferSource, Input } from 'mediabunny';
import { aacLcM4a44_100Fixture } from './helpers/os-audio-codec-fixtures.ts';
import { implicitAacFixture } from './helpers/implicit-sbr-aac-fixture.ts';
import { opaqueIsoHeAacFixture } from './helpers/opaque-iso-aac-fixture.ts';
import { buildDesktopAudioFfmpegPlan } from '../desktop/desktop-audio-ffmpeg-plan.ts';
import { deriveDesktopAudioCodecOperation, type DesktopAudioCodecProviderRuntime } from '../desktop/desktop-audio-codec-broker.ts';
import { loadFdkAacRuntime } from '../desktop/fdk-aac-runtime.ts';

import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import type { ExternalFfmpegRuntimeAdmission } from '../desktop/external-ffmpeg-preference-service.ts';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import type { DesktopCodecPreflightResult, DesktopCodecProviderKind } from '../src/common/editor/desktop-codec-coordinator.ts';
import { floatWave } from './helpers/float32-wave-fixture.ts';

const SCRATCH = '/private/desktop-codecs';
const stageRoot = process.env.FDK_AAC_TEST_STAGE;
const target = stageRoot && resolve(stageRoot);
const source = Object.freeze({ sampleRate: 48_000, channelCount: 2, frameCount: 12_501 });

test('the AAC fallback chooses the raw ADTS demuxer for a stored AAC stream', () => {
	const input = Uint8Array.of(0xff, 0xf1, 0x4c, 0x80, 0x2b, 0xff, 0xfc);
	const plan = buildDesktopAudioFfmpegPlan(decodeRequest(input));
	assert.deepEqual(plan.arguments.slice(plan.arguments.indexOf('-f'), plan.arguments.indexOf('-f') + 4),
		['-f', 'aac', '-c:a', 'aac']);
});

test('the staged FDK binary encodes and decodes AAC-LC without priming or tail padding', { skip: !target }, async () => {
	await using directory = await scratch();
	const codec = await loadFdkAacRuntime({ runtimeRoot: join(target!, 'runtime'), desktopRoot: join(target!, 'desktop'),
		scratchRoot: directory.path, target: 'linux-x64' });
	assert.ok(codec);
	const pcm = new Float32Array(source.frameCount * source.channelCount);
	for (let frame = 0; frame < source.frameCount; frame += 1) {
		pcm[frame * 2] = Math.sin(2 * Math.PI * 440 * frame / source.sampleRate) * 0.5;
	}
	const request = {
		operation: 'audio-encode', format: 'aac-m4a', settings: { bitrateKbps: 160 },
		input: new Uint8Array(pcm.buffer), maximumOutputBytes: 256_000, ...source,
	} as const;
	const { frameCount, ...closedRequest } = request;
	const encoded = await codec.runtime.execute(closedRequest, { operation: deriveDesktopAudioCodecOperation(closedRequest) }) as
		{ status: string; output: Uint8Array };
	assert.equal(encoded.status, 'executed');
	const validation = new Input({ source: new BufferSource(encoded.output), formats: [MP4] });
	try {
		const track = await validation.getPrimaryAudioTrack();
		assert.equal(await track?.getCodecParameterString(), 'mp4a.40.2');
		assert.ok(Math.abs((await track!.computeDuration()) * source.sampleRate - source.frameCount) < 1);
		assert.ok(Math.abs((await track!.getFirstTimestamp()) * source.sampleRate + 2048) < 1);
	} finally { validation.dispose(); }

	const outcome = await decode(codec.runtime, encoded.output, request.input.byteLength);
	assert.ok(outcome && typeof outcome === 'object' && 'status' in outcome && outcome.status === 'executed');
	assert.deepEqual('decodedGeometry' in outcome && outcome.decodedGeometry, { ...source });
	assert.ok('output' in outcome && outcome.output instanceof Uint8Array);
	const samples = new Float32Array(Uint8Array.from(outcome.output).buffer);
	assert.equal(samples.length, pcm.length);
	let dot = 0, left = 0, right = 0;
	for (let frame = 0; frame < source.frameCount; frame += 1) {
		const i = frame * 2;
		dot += samples[i]! * pcm[i]!;
		left += samples[i]! ** 2;
		right += samples[i + 1]! ** 2;
	}
	assert.ok(dot / left > 0.95 && right / left < 0.001, 'the left-channel tone survives in phase');
	const inputPath = join(directory.path, 'input.pcm');
	const outputPath = join(directory.path, 'output.m4a');
	await writeFile(inputPath, closedRequest.input);
	const size = await codec.encodeStream({ schemaVersion: 1, type: 'audio-stream-job', inputPath, outputPath,
		inputSha256: createHash('sha256').update(closedRequest.input).digest('hex'),
		plan: { schemaVersion: 1, frameCount, maximumOutputBytes: 256_000, tuple: {
			operation: request.operation, format: request.format, sampleRate: request.sampleRate,
			channelCount: request.channelCount, settings: request.settings,
		} },
	}, new AbortController().signal);
	const streamed = await readFile(outputPath);
	assert.equal(size, streamed.length);
	assert.deepEqual(await decode(codec.runtime, streamed, request.input.byteLength), outcome);
});

test('the staged FDK decoder declines non-LC and accepts external AAC-LC', { skip: !target }, async () => {
	await using directory = await scratch();
	const codec = await loadFdkAacRuntime({ runtimeRoot: join(target!, 'runtime'), desktopRoot: join(target!, 'desktop'),
		scratchRoot: directory.path, target: 'linux-x64' });
	assert.ok(codec);
	assert.ok(await decode(codec.runtime, aacLcM4a44_100Fixture()));
	assert.ok(await decode(codec.runtime, new Uint8Array(await implicitAacFixture('lc').file.arrayBuffer())));
	// HE-AAC v1 in ADTS uses LC transport signaling. The real SBR
	// payload comes from upstream FDK 2.0.3 encoding a generated 440 Hz tone.
	const he = new Uint8Array(await implicitAacFixture('he').file.arrayBuffer());
	const input = new Input({ source: new BufferSource(he), formats: [ADTS] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.equal(await track?.getCodecParameterString(), 'mp4a.40.2');
		assert.equal(await track?.getSampleRate(), 24_000);
	} finally { input.dispose(); }
	assert.equal(await decode(codec.runtime, he), null);
	assert.equal(await decode(codec.runtime, opaqueIsoHeAacFixture()), null);
});

test('AAC export capability and execution prefer the platform only when its tuple is admitted', async () => {
	const request = {
		operation: 'audio-encode', sampleRate: 48_000, channelCount: 2, format: 'aac-m4a', settings: { bitrateKbps: 160 },
		input: Uint8Array.from(new Uint8Array(8)), maximumOutputBytes: 1024,
	} as const;
	const tuple = { operation: 'audio-encode', format: request.format, sampleRate: 48_000,
		channelCount: 2, settings: request.settings } as const;
	for (const [disposition, expected, outputByte] of [
		['supported', 'operating-system', 2], ['unsupported', 'bundled', 1],
	] as const) {
		const trace: string[] = [];
		const service = createDesktopAudioCodecRuntimeComposition({
			target: 'mac-arm64', scratchRoot: SCRATCH,
			bundledAacRuntime: makeRuntime('bundled', 'supported', trace, Uint8Array.of(1))({ target: 'mac-arm64' }),
			createOperatingSystemRuntime: makeRuntime('operating-system', disposition, trace, Uint8Array.of(2)),
			externalFfmpegPreferences: preferences(() => null),
		});
		const result = await service.capabilities({ schemaVersion: 2, operations: [tuple] });
		assert.equal(result.capabilities[0]?.provider, expected);
		assert.equal(trace[0], 'preflight:operating-system');
		assert.deepEqual((await service.execute(request, executionOptions())).bytes, Uint8Array.of(outputByte));
	}
});

test('AAC content refused by the bundled decoder is sent intact to FFmpeg', async () => {
	const trace: string[] = [];
	const input = Uint8Array.of(0xff, 0xf1, 0x58, 0x80, 0, 0xff, 0xfc);
	const request = { ...decodeRequest(input) } as const;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'mac-arm64', scratchRoot: SCRATCH,
		bundledAacRuntime: {
			...makeRuntime('bundled', 'supported', trace, Uint8Array.of(1))({ target: 'mac-arm64' }),
			preflightRequest: () => Promise.resolve({ disposition: 'unsupported', reason: 'AAC profile requires SBR' }),
		},
		createOperatingSystemRuntime: makeRuntime('operating-system', 'supported', trace, Uint8Array.of(2)),
		externalFfmpegPreferences: preferences(() => ({
			...ffmpegAdmission(),
			capabilities: { encoders: ['pcm_f32le'], decoders: ['aac'], muxers: ['wav'], demuxers: ['aac'], filters: [] },
		})),
		createExternalRunner: () => ({
			execute(operation) {
				assert.deepEqual(operation.input, input);
				trace.push('execute:ffmpeg');
				return Promise.resolve({ status: 'executed', output: floatWave(48_000, 2, new Uint8Array(new Float32Array([0.75, 0.25]).buffer)), log: '' });
			},
		}),
	});
	const result = await service.execute(request, executionOptions());
	assert.equal(result.operation, 'audio-decode');
	assert.equal(result.metadata.frameCount, 1);
	assert.deepEqual(trace, ['preflight:bundled', 'execute:ffmpeg']);
});

function decodeRequest(input: Uint8Array) {
	return { operation: 'audio-decode', format: 'aac-m4a', sampleRate: null, channelCount: null,
		settings: { sampleFormat: 'f32le' }, input: Uint8Array.from(input), maximumOutputBytes: 1_000_000 } as const;
}

async function decode(runtime: DesktopAudioCodecProviderRuntime, input: Uint8Array, maximumOutputBytes = 1_000_000): Promise<unknown> {
	const request = { ...decodeRequest(input), maximumOutputBytes };
	const operation = deriveDesktopAudioCodecOperation(request);
	const bound = await runtime.selectRequestRuntime?.(request, { operation });
	assert.ok(bound?.preflightRequest);
	const preflight = await bound.preflightRequest(request, { operation });
	if (preflight.disposition !== 'supported') return null;
	return await bound.execute(request, { operation });
}

async function scratch() {
	const path = await mkdtemp(join(tmpdir(), 'fdk-aac-test-'));
	return { path, async [Symbol.asyncDispose]() { await rm(path, { recursive: true, force: true }); } };
}

function makeRuntime(kind: DesktopCodecProviderKind, disposition: DesktopCodecPreflightResult['disposition'],
	trace: string[], output: Uint8Array) {
	return (_context: { target: string }): DesktopAudioCodecProviderRuntime => ({
		provider: { kind, id: `${kind}-aac-test`, implementation: kind, version: '1.0.0', capabilityGeneration: kind,
			preflight: () => {
				trace.push(`preflight:${kind}`);
				return Promise.resolve(disposition === 'supported' ? { disposition, reason: null } : { disposition, reason: kind });
			} },
		execute: () => Promise.resolve({ status: 'executed', output }),
	});
}
function ffmpegAdmission() {
	const version = '9.0.1', ffmpegPath = '/tools/ffmpeg', ffprobePath = '/tools/ffprobe';
	const ffmpegSha256 = '1'.repeat(64), ffprobeSha256 = '2'.repeat(64);
	return { executablePath: ffmpegPath, version, capabilityGeneration: '4'.repeat(64),
		identity: { version, ffmpegSha256, ffprobePath, ffprobeSha256, executablePairClosureSha256:
			externalFfmpegExecutablePairClosureSha256({ ffmpegPath, ffprobePath, ffmpegSha256, ffprobeSha256 }) },
	};
}
function preferences(admission: () => ExternalFfmpegRuntimeAdmission | null) {
	return { admission, invalidateAdmission: () => Promise.reject(new Error('The test FFmpeg admission must remain available.')) };
}
function executionOptions() { return { signal: new AbortController().signal }; }
