/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { decodeStandaloneAudioForImport } from '../src/common/editor/controller/import/internal/standalone-audio-import-decoder.ts';
import { nativeTtaFixture } from './helpers/native-tta-fixture.ts';

for (const inspect of [inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate]) test(`ordinary TrueAudio source pins its96k ${inspect.name} clock`, async () => {
	const bytes = new Uint8Array(await nativeTtaFixture().file.arrayBuffer());
	assert.equal(inspect(bytes), 96_000);
	const backing = new Uint8Array(bytes.length + 29); backing.set(bytes, 17);
	assert.equal(inspect(backing.subarray(17, 17 + bytes.length)), 96_000);
});

test('standalone native TrueAudio import asks for the authenticated source clock rather than a44.1k device', async () => {
	const { file } = nativeTtaFixture(), requested: (number | null)[] = [];
	const result = await decodeStandaloneAudioForImport({ file, codecRuntime: {}, sampleRate: 48_000,
		async getAudioContext() { return { sampleRate: 44_100 }; },
		async decodeWithWebAudio(_encoded, rate) { requested.push(rate); return { sampleRate: rate ?? 44_100 }; },
		async decodeWithCodec() { throw new Error('The native-supported source must not use fallback.'); },
		async bufferFromChannels() { throw new Error('Native PCM is already decoded.'); },
		inspectEncodedSampleRate: inspectEncodedAudioSampleRate, inspectDecodedSampleRate: inspectDecodedAudioSampleRate,
	});
	assert.deepEqual(requested, [96_000]); assert.equal(result.decoded.sampleRate, 96_000); assert.equal(result.originalSampleRate, 96_000);
});

test('TTA clock authority declines corrupted headers and incomplete or inconsistent seek inventories', async () => {
	const { crc32 } = await import('node:zlib');
	const original = new Uint8Array(await nativeTtaFixture().file.arrayBuffer());
	for (const [offset, value, width] of [[0, 0, 1], [4, 2, 2], [6, 0, 2], [6, 3, 2], [8, 32, 2], [10, 0, 4], [10, 1000, 4], [10, 768000, 4], [14, 0, 4]] as const) {
		const bytes = Uint8Array.from(original), view = new DataView(bytes.buffer);
		if (width === 4) view.setUint32(offset, value, true); else if (width === 2) view.setUint16(offset, value, true); else view.setUint8(offset, value);
		view.setUint32(18, crc32(bytes.subarray(0, 18)), true);
		assert.equal(inspectEncodedAudioSampleRate(bytes), null); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	for (const offset of [12, 18, 22, 26]) {
		const bytes = Uint8Array.from(original); bytes[offset] = bytes[offset]! ^ 1;
		assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	for (const size of [0, 3, original.length]) {
		const bytes = Uint8Array.from(original), view = new DataView(bytes.buffer);
		view.setUint32(22, size, true); view.setUint32(26, crc32(bytes.subarray(22, 26)), true);
		assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	for (const length of [0, 21, 29, 100]) assert.equal(inspectDecodedAudioSampleRate(original.subarray(0, length)), null);
});
