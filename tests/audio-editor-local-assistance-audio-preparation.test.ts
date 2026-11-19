/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceAudioWaveFromChunks,
	releaseLocalAssistancePreparedAudioWave,
	type LocalAssistanceAudioWaveSpoolV1,
} from '../src/common/editor/controller/assistance/internal/audio/local-assistance-audio-preparation.ts';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

for (const [operation, modelRate, mono] of [
	['speech-enhancement', 48000, false], ['dereverberation', 44100, false], ['source-separation', 44100, false],
	['voice-activity-detection', 16000, true], ['speech-recognition', 16000, true], ['word-alignment', 16000, true],
	['speaker-diarization', 16000, true], ['audio-tagging', 32000, true], ['beat-tracking', 22050, true],
] as const) test(`${operation} conforms differing source rates to ${modelRate} Hz before inference`, async () => {
	for (const inputRate of [16000, 44100, 48000, 96000]) {
		const frames = Math.floor(inputRate / 4) + 17;
		async function* chunks() {
			for (let start = 0; start < frames; start += 307) yield [0.4, 0.2].map(gain => Float32Array.from(
				{ length: Math.min(307, frames - start) }, (_, i) => gain * Math.sin(2 * Math.PI * 997 * (start + i) / inputRate)));
		}
		const body = await createLocalAssistanceAudioWaveFromChunks(operation, chunks(), frames, inputRate, 2);
		try {
			const geometry = await inspectWavBlobPcm(body);
			assert.equal(geometry.sampleRate, modelRate);
			assert.equal(geometry.channelCount, mono ? 1 : 2);
			assert.equal(geometry.frameCount, Math.round(frames * modelRate / inputRate));
			let offset = 0, squaredError = 0, count = 0;
			await streamWavBlobPcm(body, { chunkFrames: 521, onChunk: (planes: Float32Array[]) => {
				for (let c = 0; c < planes.length; c++) for (let i = 0; i < planes[c]!.length; i++) {
					const frame = offset + i;
					if (frame < 100 || frame >= geometry.frameCount - 100) continue;
					const expected = (mono ? .3 : c === 0 ? .4 : .2) * Math.sin(2 * Math.PI * 997 * frame / modelRate);
					squaredError += (planes[c]![i]! - expected) ** 2; count++;
				}
				offset += planes[0]!.length;
			} });
			assert.equal(offset, geometry.frameCount);
			assert.ok(Math.sqrt(squaredError / count) < .001, `${inputRate} Hz RMS ${Math.sqrt(squaredError / count)}`);
		} finally { await releaseLocalAssistancePreparedAudioWave(body); }
	}
});

test('long assistance preparation writes bounded chunks to a disposable spool and releases it', async () => {
	const writes: Uint8Array[] = [];
	let closed = 0;
	let aborted = 0;
	let released = 0;
	const spool: LocalAssistanceAudioWaveSpoolV1 = Object.freeze({
		async write(chunk: Uint8Array) { writes.push(chunk.slice()); },
		async close(mediaType: 'audio/wav') {
			closed += 1;
			return Object.freeze({ body: new Blob(writes.map(
				(chunk) => chunk.slice().buffer as ArrayBuffer,
			), { type: mediaType }),
				async release() { released += 1; } });
		},
		async abort() { aborted += 1; },
	});
	async function* chunks() {
		yield [new Float32Array(65_536)];
		yield [new Float32Array(65_536)];
	}
	const body = await createLocalAssistanceAudioWaveFromChunks(
		'audio-tagging', chunks(), 131_072, 32_000, 1, undefined,
		{ maximumInMemoryByteLength: 1, openSpool: async () => spool },
	);

	assert.equal(closed, 1);
	assert.equal(aborted, 0);
	assert.equal(writes[0]!.byteLength, 44);
	assert.ok(writes.slice(1).every((chunk) => chunk.byteLength <= 65_536 * 4));
	assert.equal((await inspectWavBlobPcm(body)).frameCount, 131_072);
	await releaseLocalAssistancePreparedAudioWave(body);
	await releaseLocalAssistancePreparedAudioWave(body);
	assert.equal(released, 1);
});

test('assistance preparation aborts its disposable spool on inexact or cancelled input', async () => {
	let aborted = 0;
	const spool: LocalAssistanceAudioWaveSpoolV1 = Object.freeze({
		write: async () => undefined,
		close: async () => { throw new Error('must not close'); },
		async abort() { aborted += 1; },
	});
	async function* chunks() { yield [new Float32Array(1)]; }
	await assert.rejects(createLocalAssistanceAudioWaveFromChunks(
		'beat-tracking', chunks(), 2, 22_050, 1, undefined,
		{ maximumInMemoryByteLength: 1, openSpool: async () => spool },
	), /inexact|geometry/iu);
	assert.equal(aborted, 1);
});

test('desktop OPFS spill is capacity-checked, disk-backed, and removed after custody', async () => {
	const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const parts: ArrayBuffer[] = [];
	let removed = 0;
	const directory = {
		async getFileHandle(name: string) {
			return {
				async createWritable() {
					return {
						async write(part: ArrayBuffer) { parts.push(part.slice(0)); },
						async close() {}, async abort() {},
					};
				},
				async getFile() { return new File(parts, name); },
			};
		},
		async removeEntry() { removed += 1; },
	};
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
		storage: {
			estimate: async () => ({ quota: 1024 * 1024, usage: 0 }),
			getDirectory: async () => ({ getDirectoryHandle: async () => directory }),
		},
	} });
	try {
		async function* chunks() { yield [Float32Array.of(0.25, -0.25)]; }
		const body = await createLocalAssistanceAudioWaveFromChunks(
			'beat-tracking', chunks(), 2, 22_050, 1, undefined,
			{ maximumInMemoryByteLength: 1 },
		);
		assert.equal(body.size, 52);
		assert.equal(body.type, 'audio/wav');
		assert.equal(removed, 0);
		await releaseLocalAssistancePreparedAudioWave(body);
		assert.equal(removed, 1);
	} finally {
		if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
});
