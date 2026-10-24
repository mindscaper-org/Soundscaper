/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeStandaloneAudioForImport } from '../src/common/editor/controller/import/internal/standalone-audio-import-decoder.ts';
import { nativeG711OddWavFixture } from './helpers/native-g711-odd-wav-fixture.ts';

for (const format of ['alaw', 'ulaw'] as const) test(`native ${format} import finishes a terminal odd RIFF data chunk without changing its samples`, async () => {
	const { file } = nativeG711OddWavFixture(format), original = await file.arrayBuffer();
	const calls: ArrayBuffer[] = [];
	const result = await decodeStandaloneAudioForImport({ file, codecRuntime: null, sampleRate: 48_000,
		getAudioContext: async () => ({}), inspectEncodedSampleRate: () => 48_000, inspectDecodedSampleRate: () => 48_000,
		async decodeWithWebAudio(encoded) {
			calls.push(encoded);
			return { sampleRate: 48_000, length: 4801 };
		},
		async decodeWithCodec() { assert.fail('The existing native format must finish without external codec fallback.'); },
		async bufferFromChannels() { assert.fail('No alternate PCM producer is needed.'); },
	});
	assert.equal(calls.length, 1); assert.equal(result.decoded.length, 4801);
	const encoded = calls[0]!;
	assert.equal(encoded.byteLength, original.byteLength + 8);
	assert.equal(new TextDecoder().decode(encoded.slice(-8, -4)), 'JUNK');
	assert.deepEqual(new Uint8Array(encoded).subarray(8, original.byteLength), new Uint8Array(original).subarray(8));
});

test('the native RIFF preparation is idempotent and preserves every original encoded byte except the RIFF size', async () => {
	const { prepareNativeRiffAudioDecode } = await import('../src/common/editor/native-riff-audio-padding.ts');
	const original = await nativeG711OddWavFixture('alaw').file.arrayBuffer(), before = original.slice(0);
	const prepared = prepareNativeRiffAudioDecode(original);
	assert.notEqual(prepared, original); assert.deepEqual(original, before);
	assert.equal(new DataView(prepared).getUint32(4, true), prepared.byteLength - 8);
	assert.deepEqual(new Uint8Array(prepared).subarray(8, original.byteLength), new Uint8Array(original).subarray(8));
	assert.equal(new DataView(prepared).getUint32(prepared.byteLength - 4, true), 0);
	assert.equal(prepareNativeRiffAudioDecode(prepared), prepared);
	const optional = new Uint8Array(original.byteLength + 10); optional.set(new Uint8Array(original).subarray(0, 12));
	optional.set(new TextEncoder().encode('JUNK'), 12); new DataView(optional.buffer).setUint32(16, 1, true);
	optional.set(new Uint8Array(original).subarray(12), 22); new DataView(optional.buffer).setUint32(4, optional.length - 8, true);
	assert.equal(prepareNativeRiffAudioDecode(optional.buffer).byteLength, optional.length + 8);
});

test('malformed, contradictory and unqualified RIFF profiles retain their original native input', async () => {
	const { prepareNativeRiffAudioDecode } = await import('../src/common/editor/native-riff-audio-padding.ts');
	const original = await nativeG711OddWavFixture('ulaw').file.arrayBuffer(), source = new Uint8Array(original);
	const changes: ReadonlyArray<(bytes: Uint8Array<ArrayBuffer>, view: DataView) => void> = [
		bytes => { bytes[0] = 0; }, bytes => { bytes[8] = 0; }, (_bytes, view) => { view.setUint32(4, original.byteLength - 9, true); },
		(_bytes, view) => { view.setUint32(16, 17, true); }, (_bytes, view) => { view.setUint16(20, 1, true); },
		(_bytes, view) => { view.setUint16(20, 17, true); }, (_bytes, view) => { view.setUint16(22, 2, true); },
		(_bytes, view) => { view.setUint32(24, 1000, true); }, (_bytes, view) => { view.setUint32(28, 0, true); },
		(_bytes, view) => { view.setUint16(32, 2, true); }, (_bytes, view) => { view.setUint16(34, 16, true); },
		(_bytes, view) => { view.setUint16(36, 1, true); }, (_bytes, view) => { view.setUint32(42, 0, true); },
		(_bytes, view) => { view.setUint32(46, 0, true); }, (_bytes, view) => { view.setUint32(46, 4800, true); },
		(_bytes, view) => { view.setUint32(54, 4800, true); },
	];
	for (const change of changes) {
		const bytes = Uint8Array.from(source); change(bytes, new DataView(bytes.buffer));
		assert.equal(prepareNativeRiffAudioDecode(bytes.buffer), bytes.buffer);
	}
	for (const length of [0, 11, 57, original.byteLength - 1]) {
		const truncated = original.slice(0, length); assert.equal(prepareNativeRiffAudioDecode(truncated), truncated);
	}
	for (const chunk of [source.subarray(12, 38), source.subarray(38, 50), source.subarray(50)]) {
		const duplicate = new Uint8Array(source.length + chunk.length); duplicate.set(source); duplicate.set(chunk, source.length);
		new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
		assert.equal(prepareNativeRiffAudioDecode(duplicate.buffer), duplicate.buffer);
	}
	const excess = new Uint8Array(source.length + 4096 * 8); excess.set(source.subarray(0, 12));
	for (let offset = 12; offset < 12 + 4096 * 8; offset += 8) excess.set(new TextEncoder().encode('JUNK'), offset);
	excess.set(source.subarray(12), 12 + 4096 * 8); new DataView(excess.buffer).setUint32(4, excess.length - 8, true);
	assert.equal(prepareNativeRiffAudioDecode(excess.buffer), excess.buffer);
});

for (const format of ['alaw', 'ulaw'] as const) test(`even native ${format} data requires no RIFF preparation`, async () => {
	const { prepareNativeRiffAudioDecode } = await import('../src/common/editor/native-riff-audio-padding.ts');
	const encoded = await nativeG711OddWavFixture(format, 4800).file.arrayBuffer();
	assert.equal(prepareNativeRiffAudioDecode(encoded), encoded);
});
