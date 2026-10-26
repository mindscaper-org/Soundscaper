/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { nativeSpeexFixture } from './helpers/native-speex-fixture.ts';
import { inspectStreamedAudioImportFile } from '../src/common/editor/streamed-audio-content-admission.ts';
import { hasNativeOggSpeexIdentity, inspectOggSpeexSampleRate } from '../src/common/editor/ogg-speex-source-identity.ts';
import { oggPageCrc } from '../src/common/editor/ogg-page-crc.ts';
import { ordinaryOggOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

test('ordinary Ogg Speex storage retains its encoded16k clock', async () => {
	assert.equal(inspectEncodedAudioSampleRate(await nativeSpeexFixture().file.arrayBuffer()), 16_000);
});

test('native Ogg Speex decode is pinned to its own16k clock instead of the output device', async () => {
	assert.equal(inspectDecodedAudioSampleRate(await nativeSpeexFixture().file.arrayBuffer()), 16_000);
});

test('identified native Speex keeps its full-file route under the normal Ogg MIME', async () => {
	const original = nativeSpeexFixture().file;
	const ogg = new File([await original.arrayBuffer()], original.name, { type: 'audio/ogg' });
	assert.equal(await inspectStreamedAudioImportFile(ogg), false);
	assert.equal(await inspectStreamedAudioImportFile(original), false);
});

function pageRanges(bytes: Uint8Array): Readonly<{ start: number; end: number }>[] {
	const result = [];
	for (let start = 0; start < bytes.length;) {
		const count = bytes[start + 26]!, end = start + 27 + count + bytes.subarray(start + 27, start + 27 + count).reduce((sum, byte) => sum + byte, 0);
		result.push({ start, end }); start = end;
	}
	return result;
}

function corrected(bytes: Uint8Array<ArrayBuffer>, index: number): Uint8Array<ArrayBuffer> {
	const range = pageRanges(bytes)[index]!;
	new DataView(bytes.buffer).setUint32(range.start + 22, oggPageCrc(bytes.subarray(range.start, range.end)), true);
	return bytes;
}

test('Speex identity respects byte views and uses bounded per-page reads', async () => {
	const original = new Uint8Array(await nativeSpeexFixture().file.arrayBuffer()), backing = new Uint8Array(original.length + 19);
	backing.set(original, 7); assert.equal(inspectOggSpeexSampleRate(backing.subarray(7, 7 + original.length)), 16_000);
	const reads: number[] = [];
	class ObservedFile extends File {
		override slice(start = 0, end = this.size, type?: string): Blob { reads.push(end - start); return super.slice(start, end, type); }
	}
	assert.equal(await hasNativeOggSpeexIdentity(new ObservedFile([original], 'Voice.spx')), true);
	assert.ok(reads.length > 3); assert.ok(Math.max(...reads) <= 65_307); assert.ok(Math.max(...reads) < original.length);
});

test('malformed, truncated, checksum-bad and unqualified Speex headers never take native-only ownership', async () => {
	const original = new Uint8Array(await nativeSpeexFixture().file.arrayBuffer()), malformed: Uint8Array[] = [];
	for (const end of [0, 27, 80, 107, original.length - 1]) malformed.push(original.subarray(0, end));
	for (const [offset, value] of [[0, 0], [4, 1], [5, 0], [18, 1], [28, 0], [56, 2], [60, 81], [64, 48_000],
		[68, 3], [72, 3], [76, 2], [84, 0], [92, 0], [96, 1]]) {
		const bytes = Uint8Array.from(original); new DataView(bytes.buffer).setUint32(offset!, value!, true); malformed.push(corrected(bytes, 0));
	}
	const crc = Uint8Array.from(original); crc[crc.length - 1]! ^= 1; malformed.push(crc);
	for (const bytes of malformed) {
		assert.equal(inspectOggSpeexSampleRate(bytes), null);
		assert.equal(await inspectStreamedAudioImportFile(new File([Uint8Array.from(bytes)], 'Voice.spx', { type: 'audio/ogg' })), true);
	}
});

test('multiplexed/chained streams, incomplete EOS and malformed comment extents retain prior ownership', async () => {
	const original = new Uint8Array(await nativeSpeexFixture().file.arrayBuffer()), ranges = pageRanges(original), bad: Uint8Array[] = [];
	for (const [page, field, value] of [[1, 14, 123], [1, 18, 99], [1, 5, 2], [2, 5, 0], [1, 28, 0xffff_ffff]] as const) {
		const bytes = Uint8Array.from(original), offset = ranges[page]!.start + field;
		if (field === 5) bytes[offset] = value; else new DataView(bytes.buffer).setUint32(offset, value, true);
		bad.push(corrected(bytes, page));
	}
	const huge = Uint8Array.from(original); new DataView(huge.buffer).setBigInt64(ranges[2]!.start + 6, 2n ** 54n, true); bad.push(corrected(huge, 2));
	const chained = new Uint8Array(original.length * 2); chained.set(original); chained.set(original, original.length); bad.push(chained);
	for (const bytes of bad) {
		assert.equal(inspectOggSpeexSampleRate(bytes), null);
		assert.equal(await hasNativeOggSpeexIdentity(new Blob([Uint8Array.from(bytes)])), false);
	}
	const opus = await ordinaryOggOpusFixture();
	assert.equal(inspectOggSpeexSampleRate(new Uint8Array(await opus.arrayBuffer())), null);
	assert.equal(await inspectStreamedAudioImportFile(opus), true);
	assert.equal(inspectDecodedAudioSampleRate(await opus.arrayBuffer()), 48_000);
});

test('Speex identity admission retires pending reads on Cancel and refuses encoded oversize before I/O', async () => {
	const original = nativeSpeexFixture().file, controller = new AbortController(), reason = new DOMException('Cancelled', 'AbortError');
	let release!: (value: ArrayBuffer) => void, started!: () => void, reads = 0;
	const pending = new Promise<ArrayBuffer>(resolve => { release = resolve; }), begun = new Promise<void>(resolve => { started = resolve; });
	class HeldFile extends File {
		override slice(): Blob { reads++; started(); return Object.assign(new Blob(), { arrayBuffer: () => pending }); }
	}
	const operation = inspectStreamedAudioImportFile(new HeldFile([await original.arrayBuffer()], 'Voice.spx', { type: 'audio/ogg' }), controller.signal);
	await begun; controller.abort(reason); await assert.rejects(operation, error => error === reason);
	release(await original.slice(0, 108).arrayBuffer()); await Promise.resolve(); assert.equal(reads, 1);
	class OversizedFile extends File { override get size(): number { return 32 * 1024 ** 2 + 1; } override slice(): Blob { throw new Error('No read admitted.'); } }
	assert.equal(await hasNativeOggSpeexIdentity(new OversizedFile([], 'Large.spx')), false);
});
