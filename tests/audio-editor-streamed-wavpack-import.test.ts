/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm, decodeDedicatedAudioFile } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { createAudacityWavPackFixture, withWavPackTotalFrames } from './helpers/wavpack-import-fixture.ts';

const loadPayload = async (_format: unknown, url: URL) => new Uint8Array(await readFile(url));

async function original(frames = 96_000) {
	const pcm = new Float32Array(frames * 2);
	for (let frame = 0; frame < frames; frame++) { pcm[frame * 2] = Math.sin(frame * 0.1) * 0.2; pcm[frame * 2 + 1] = Math.cos(frame * 0.03) * 0.1; }
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer),
		frameCount: frames, channelCount: 2, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 2 * 1024 * 1024,
	}, { loadPayload });
	class RangedOriginal extends File {
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file read forbidden'); }
	}
	return { pcm, encoded, file: new RangedOriginal([encoded], 'recording.wv', { type: 'audio/wavpack' }) };
}

test('bounded WavPack groups preserve exact lossless PCM across source chunk boundaries', async () => {
	const { file, pcm } = await original();
	const requests: number[] = [];
	const prepared = await prepareStreamedAudioImport(file, { desktopCodec: {
		async decode(group) {
			requests.push(group.size);
			assert.ok(group.size < 4 * 1024 * 1024);
			const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await group.arrayBuffer()), maximumOutputBytes: 2 * 1024 * 1024 }, { loadPayload });
			const data = new DataView(decoded.interleaved.buffer);
			const channels = Array.from({ length: decoded.channelCount }, (_, channel) => Float32Array.from({ length: decoded.frameCount }, (_value, frame) => data.getFloat32((frame * decoded.channelCount + channel) * 4, true)));
			return { channels, sampleRate: decoded.sampleRate };
		},
	} });
	assert.equal(prepared.descriptor.frameCount, pcm.length / 2);
	let position = 0;
	await prepared.stream({ chunkFrames: 16_384, onChunk(channels) {
		assert.ok(channels[0]!.length <= 16_384);
		for (let frame = 0; frame < channels[0]!.length; frame++) {
			assert.equal(channels[0]![frame], pcm[(position + frame) * 2]);
			assert.equal(channels[1]![frame], pcm[(position + frame) * 2 + 1]);
		}
		position += channels[0]!.length;
	} });
	assert.equal(position, pcm.length / 2);
	assert.ok(requests.length > 1);
});

test('the original WavPack checksum is checked before header indexes are rewritten', async () => {
	const { encoded } = await original(48_000);
	encoded[12] ^= 1;
	await assert.rejects(prepareStreamedAudioImport(new File([encoded], 'corrupt.wv')), /checksum/u);
});

test('WavPack continuation groups may leave their total sample count unknown', async () => {
	const continued = await createAudacityWavPackFixture();
	const prepared = await prepareStreamedAudioImport(new File([continued], 'streamed.wv'), {
		desktopCodec: geometryDecoder(),
	});
	let frames = 0;
	await prepared.stream({ chunkFrames: 4_096, onChunk(channels) { frames += channels[0]!.length; } });
	assert.equal(frames, 96_000);
});

test('integer WavPack groups reach the supplied decoder with source geometry intact', async () => {
	const encoded = integerOriginal();
	let calls = 0;
	const prepared = await prepareStreamedAudioImport(new File([encoded], 'integer.wv'), {
		desktopCodec: { async decode(group) {
			calls += 1;
			const bytes = new DataView(await group.arrayBuffer());
			assert.equal(bytes.getUint32(24, true) & 0x83, 1, 'the decoder must receive integer16 WavPack');
			assert.equal(bytes.getUint32(12, true), 48);
			assert.equal(bytes.getUint32(16, true), 0);
			return { channels: [new Float32Array(48)], sampleRate: 48_000 };
		} },
	});
	assert.equal(prepared.descriptor.channelCount, 1);
	assert.equal(prepared.descriptor.frameCount, 48);
	await prepared.stream({ chunkFrames: 4_096, onChunk() {} });
	assert.equal(calls, 1);
});

test('integer WavPack admission retains lossless-profile and original-checksum checks', async () => {
	const hybrid = integerOriginal();
	const hybridView = new DataView(hybrid.buffer);
	hybridView.setUint32(24, hybridView.getUint32(24, true) | 0x8, true);
	await assert.rejects(prepareStreamedAudioImport(new File([withWavPackTotalFrames(hybrid, 48)], 'hybrid.wv')), /unsupported/u);
	const corrupt = integerOriginal();
	corrupt[40] ^= 1;
	await assert.rejects(prepareStreamedAudioImport(new File([corrupt], 'corrupt-integer.wv')), /checksum/u);
});

test('unknown WavPack totals require a known first declaration and consistent continuations', async () => {
	const { encoded } = await original();
	const groups = splitGroups(encoded);
	await assert.rejects(prepareStreamedAudioImport(new File([withWavPackTotalFrames(groups[0]!, 0xffff_ffff)], 'unknown.wv')), /inconsistent block geometry/u);
	const inconsistent = concat(groups[0]!, withWavPackTotalFrames(groups[1]!, 96_001));
	const prepared = await prepareStreamedAudioImport(new File([inconsistent], 'inconsistent.wv'), { desktopCodec: geometryDecoder() });
	await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /non-contiguous or change source geometry/u);
});

test('a damaged or non-contiguous later WavPack group closes the stream after its valid prefix', async () => {
	const { encoded } = await original(160_000);
	const groups = splitGroups(encoded);
	assert.ok(groups.length >= 3, 'the fixture must contain a later group beyond the first continuation');
	const corruptChecksum = groups[1]!.slice();
	corruptChecksum[12] ^= 1;
	for (const [name, bytes, refusal] of [
		['truncated', concat(groups[0]!, groups[1]!.subarray(0, 10)), /truncated/u],
		['non-contiguous', concat(groups[0]!, groups[2]!), /non-contiguous/u],
		['checksum', concat(groups[0]!, corruptChecksum), /checksum/u],
	] as const) {
		let chunks = 0;
		const prepared = await prepareStreamedAudioImport(new File([bytes], `${name}.wv`), {
			desktopCodec: geometryDecoder(),
		});
		await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() { chunks += 1; } }), refusal);
		assert.ok(chunks > 0, `${name} must fail after the first group supplied PCM`);
		await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /decoder is closed/u);
	}
});

test('a later WavPack decoder geometry mismatch refuses the stream and closes its session', async () => {
	const { file } = await original();
	let decodedGroups = 0;
	const prepared = await prepareStreamedAudioImport(file, { desktopCodec: {
		async decode(group) {
			decodedGroups += 1;
			const result = await geometryDecoder().decode(group, {});
			return decodedGroups === 2
				? { ...result, channels: result.channels.slice(0, 1) }
				: result;
		},
	} });
	await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /inconsistent source geometry/u);
	assert.equal(decodedGroups, 2);
	await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /decoder is closed/u);
});

test('cancelling a pending later WavPack group decode stops the stream before another chunk', async () => {
	const { file } = await original();
	const controller = new AbortController();
	let decodedGroups = 0;
	let secondDecodeStarted!: () => void;
	let resumeSecondDecode!: (value: Awaited<ReturnType<ReturnType<typeof geometryDecoder>['decode']>>) => void;
	const entered = new Promise<void>((resolve) => { secondDecodeStarted = resolve; });
	const blocked = new Promise<Awaited<ReturnType<ReturnType<typeof geometryDecoder>['decode']>>>((resolve) => {
		resumeSecondDecode = resolve;
	});
	const prepared = await prepareStreamedAudioImport(file, { signal: controller.signal, desktopCodec: {
		async decode(group) {
			decodedGroups += 1;
			if (decodedGroups === 2) {
				secondDecodeStarted();
				return blocked;
			}
			return geometryDecoder().decode(group, {});
		},
	} });
	let chunks = 0;
	const streaming = prepared.stream({ chunkFrames: 4_096, onChunk() { chunks += 1; } });
	await entered;
	const beforeAbort = chunks;
	controller.abort();
	await assert.rejects(streaming, (error: Error) => error.name === 'AbortError');
	resumeSecondDecode({ channels: [new Float32Array(1), new Float32Array(1)], sampleRate: 48_000 });
	await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /decoder is closed/u);
	assert.equal(chunks, beforeAbort);
});

function geometryDecoder() {
	return {
		async decode(group: Blob, _options: Readonly<Record<string, unknown>>) {
			const bytes = new Uint8Array(await group.arrayBuffer());
			const frames = new DataView(bytes.buffer).getUint32(20, true);
			return { channels: [new Float32Array(frames), new Float32Array(frames)], sampleRate: 48_000 };
		},
	};
}

function integerOriginal(): Uint8Array<ArrayBuffer> {
	// FFmpeg 8.0: aevalsrc=0.5*sin(2*PI*1000*t):s=48000:d=0.001, wavpack s16p.
	const source = Uint8Array.from(Buffer.from('d3Zwa6YAAAAQBAAAMAAAAAAAAAAwAAAABRg8Bb8RIOkCAVdWAwELDAQC7/RZ9AUDoAlCCx0PijoAANf6zPbHc/+Z2X+T839a9H+C8B/k+c/B/Ie6/vsBf3bsL9l8q8/nr32vyyc1HC7vqjdHqTs66w6hq1KOX8rmWdHXgp70fjnvF0s/w/pNkJ/l+B2C994/0/83HJ5T97S79969yf5Bc08Nvxv17PDLs+9D0mIA', 'base64'));
	return withWavPackTotalFrames(source, 48);
}

function splitGroups(bytes: Uint8Array): Uint8Array[] {
	const groups: Uint8Array[] = [];
	let offset = 0;
	let groupStart = 0;
	while (offset < bytes.byteLength) {
		assert.ok(offset + 32 <= bytes.byteLength);
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		const blockLength = view.getUint32(4, true) + 8;
		assert.ok(blockLength >= 32 && offset + blockLength <= bytes.byteLength);
		offset += blockLength;
		if (view.getUint32(24, true) & 0x1000) {
			groups.push(bytes.slice(groupStart, offset));
			groupStart = offset;
		}
	}
	assert.equal(groupStart, bytes.byteLength);
	return groups;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
	return joined;
}
