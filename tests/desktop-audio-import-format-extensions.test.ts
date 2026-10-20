/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DESKTOP_AUDIO_CODEC_FORMATS, createDesktopAudioCodecResult,
	normalizeDesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import { normalizeDesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import { buildDesktopAudioFfmpegPlan, deriveDesktopAudioFfmpegCapabilityTuple } from '../desktop/desktop-audio-ffmpeg-plan.ts';
import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import { externalFfmpegExecutablePairClosureSha256 } from '../desktop/external-ffmpeg-node-runtime.ts';
import { createDesktopAudioCodecRuntime } from '../src/common/editor/desktop-audio-codec-runtime.ts';
import { floatWave } from './helpers/float32-wave-fixture.ts';
import { acceptsFile, mimeTypeForPath, validateFileChoice } from '../desktop/validation.js';
import { readProfileForSelectedPath } from '../desktop/read-selection-service.js';

const FORMATS = [
	{ format: 'matroska-mp3', demuxer: 'matroska', decoder: 'mp3float', name: 'Audacity.mka', input: Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3) },
	{ format: 'wma', demuxer: 'asf', decoder: 'wmav2', name: 'Audacity.wma', input: Uint8Array.of(0x30, 0x26, 0xb2, 0x75) },
	{ format: 'wav-mulaw', demuxer: 'wav', decoder: 'pcm_mulaw', name: 'Audacity.wav', input: compandedWav(7) },
	{ format: 'wav-alaw', demuxer: 'wav', decoder: 'pcm_alaw', name: 'Audacity.wav', input: compandedWav(6) },
] as const;

test('native import choosers admit MKA and WMA through selected range reads', () => {
	for (const [extension, mimeType] of [['mka', 'audio/x-matroska'], ['wma', 'audio/x-ms-wma']] as const) {
		for (const purpose of ['audio', 'media', 'project']) {
			const path = `/tmp/exportspike.${extension.toUpperCase()}`;
			assert.equal(acceptsFile(purpose, path), true);
			assert.equal(mimeTypeForPath(path), mimeType);
			assert.equal(readProfileForSelectedPath(purpose, path), 'selected-range-v1');
			assert.ok(validateFileChoice({ purpose }).filters.some((filter: { extensions: readonly string[] }) => filter.extensions.includes(extension)));
		}
	}
});

test('Audacity import-only formats keep source geometry and fixed FFmpeg demuxers and decoders', () => {
	for (const fixture of FORMATS) {
		const request = decodeRequest(fixture.format);
		const plan = buildDesktopAudioFfmpegPlan(request);
		assert.equal(plan.arguments[plan.arguments.indexOf('-f') + 1], fixture.demuxer);
		assert.equal(plan.arguments[plan.arguments.indexOf('-c:a') + 1], fixture.decoder);
		assert.deepEqual(deriveDesktopAudioFfmpegCapabilityTuple(request).decoderAnyOf, [fixture.decoder]);
		assert.equal(deriveDesktopAudioCodecOperation(request).direction, 'decode');
		const result = createDesktopAudioCodecResult(request, new Uint8Array(8), { sampleRate: 44_100, channelCount: 2, frameCount: 1 });
		assert.equal(result.operation, 'audio-decode');
		if (result.operation === 'audio-decode') assert.equal(result.metadata.sourceFormat, fixture.format);
	}
});

test('Audacity import-only formats cannot enter an encode contract or advertised export formats', () => {
	assert.equal(DESKTOP_AUDIO_CODEC_FORMATS.length, 7);
	for (const { format } of FORMATS) {
		assert.equal((DESKTOP_AUDIO_CODEC_FORMATS as readonly string[]).includes(format), false);
		assert.throws(() => normalizeDesktopAudioCodecRequest({
			...decodeRequest('mp3'), operation: 'audio-encode', format, sampleRate: 44_100, channelCount: 2,
			input: new Uint8Array(8), settings: { bitrateKbps: 192 },
		}), /format/iu);
		assert.throws(() => normalizeDesktopAudioCodecCapabilityQuery({
			schemaVersion: 2, operations: [{ operation: 'audio-encode', format, sampleRate: 44_100,
				channelCount: 2, settings: { bitrateKbps: 192 } }],
		}), /unsupported/iu);
		const query = normalizeDesktopAudioCodecCapabilityQuery({
			schemaVersion: 2, operations: [{ operation: 'audio-decode', format, sampleRate: 44_100,
				channelCount: 2, settings: { sampleFormat: 'f32le' } }],
		});
		assert.equal(query.operations[0]?.format, format);
	}
});

test('desktop renderer infers Audacity MKA, WMA, and proven companded WAV imports', async () => {
	const seen: string[] = [];
	const runtime = createDesktopAudioCodecRuntime({
		capabilities() { throw new Error('Decode execution resolves its source-authoritative provider.'); },
		execute(request) {
			seen.push(request.format);
			return createDesktopAudioCodecResult(request, new Uint8Array(8), { sampleRate: 44_100, channelCount: 2, frameCount: 1 });
		},
		cancel() {},
	});
	for (const fixture of FORMATS) {
		const decoded = await runtime.decode(new File([fixture.input], fixture.name));
		assert.equal(seen.at(-1), fixture.format);
		assert.equal(decoded.sampleRate, 44_100);
		assert.equal(decoded.channels.length, 2);
		await runtime.decode(new File([fixture.input], fixture.name), { format: fixture.format });
		assert.equal(seen.at(-1), fixture.format);
		const selected = new Blob([fixture.input], { type: 'application/octet-stream' });
		Object.defineProperty(selected, 'name', { value: fixture.name });
		await runtime.decode(selected);
		assert.equal(seen.at(-1), fixture.format, 'desktop range selections retain the selected filename');
	}
	for (const [alias, format] of [[' m4a ', 'aac-m4a'], ['ogg', 'ogg-vorbis']] as const) {
		await runtime.decode(new Blob([Uint8Array.of(0)]), { format: alias });
		assert.equal(seen.at(-1), format);
	}
	for (const tag of [1, 3, 85]) {
		await assert.rejects(runtime.decode(new File([compandedWav(tag)], 'unproved.wav')), /cannot determine/iu);
	}
	await assert.rejects(runtime.decode(new File([compandedWav(7).subarray(0, 21)], 'truncated.wav')), /cannot determine/iu);
	runtime.dispose();
});

test('import-only profiles resolve their admitted external FFmpeg provider and validate its PCM geometry', async () => {
	const pair = { ffmpegPath: '/private/ffmpeg', ffmpegSha256: '1'.repeat(64),
		ffprobePath: '/private/ffprobe', ffprobeSha256: '2'.repeat(64) };
	const executed: string[] = [];
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: '/private/codecs',
		externalFfmpegPreferences: {
			admission: () => ({ executablePath: pair.ffmpegPath, version: '8.0.0', capabilityGeneration: '3'.repeat(64),
				identity: { ...pair, version: '8.0.0', executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256(pair) },
				capabilities: { demuxers: FORMATS.map(({ demuxer }) => demuxer),
					decoders: FORMATS.map(({ decoder }) => decoder), encoders: ['pcm_f32le'], muxers: ['wav'], filters: [] } }),
			invalidateAdmission() { throw new Error('The admitted fixture identity must remain current.'); },
		},
		createExternalRunner: () => ({ execute({ operation }) {
			const request = normalizeDesktopAudioCodecRequest(operation);
			executed.push(request.format);
			return Promise.resolve({ status: 'executed' as const, output: floatWave(44_100, 1, new Uint8Array(4)), log: '' });
		} }),
	});
	for (const { format } of FORMATS) {
		const query = normalizeDesktopAudioCodecCapabilityQuery({ schemaVersion: 2,
			operations: [{ operation: 'audio-decode', format, sampleRate: 44_100, channelCount: 1, settings: { sampleFormat: 'f32le' } }] });
		const capability = (await service.capabilities(query)).capabilities[0];
		assert.equal(capability?.available, true, `${format}: ${capability?.reason ?? 'missing'}`);
		assert.equal(capability.provider, 'external-ffmpeg');
		const result = await service.execute(decodeRequest(format), { signal: new AbortController().signal });
		assert.equal(result.operation, 'audio-decode');
		if (result.operation === 'audio-decode') {
			assert.equal(result.metadata.channelCount, 1);
			assert.equal(result.metadata.sampleRate, 44_100);
		}
	}
	assert.deepEqual(executed, FORMATS.map(({ format }) => format));
});

function decodeRequest(format: string) {
	return normalizeDesktopAudioCodecRequest({ operation: 'audio-decode', format,
		input: Uint8Array.of(0), sampleRate: null, channelCount: null,
		settings: { sampleFormat: 'f32le' }, maximumOutputBytes: 8_192 });
}

function compandedWav(format: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(46);
	const view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, 38, true);
	bytes.set(new TextEncoder().encode('WAVEfmt '), 8); view.setUint32(16, 18, true);
	view.setUint16(20, format, true); view.setUint16(22, 2, true);
	view.setUint32(24, 44_100, true); view.setUint32(28, 88_200, true);
	view.setUint16(32, 2, true); view.setUint16(34, 8, true);
	bytes.set(new TextEncoder().encode('data'), 38);
	return bytes;
}
