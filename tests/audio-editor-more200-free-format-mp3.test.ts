/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeContainerAudioAdmission, assertNativeContainerAudioGeometry } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { freeFormatMp3Fixture, paddedFreeFormatMp3Fixture, crcOffsetMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';

for (const tagged of [false, true]) test(`native free-format MP3 source clock and programme are admitted (ID3=${String(tagged)})`, async () => {
	const original = freeFormatMp3Fixture();
	const file = tagged ? new File([Uint8Array.from(createAudioMetadataId3Tag({ title: 'Native free format' })), original], original.name) : original;
	const admission = await nativeContainerAudioAdmission(file, { nativeSampleRate: () => 44_100 });
	assert.deepEqual(admission, { sampleRate: 48_000, decodeSampleRate: 48_000, channelCount: 1, frameCount: 4800 });
	assert.doesNotThrow(() => assertNativeContainerAudioGeometry({ sampleRate: 48_000, numberOfChannels: 1, length: 4800 }, admission));
	assert.throws(() => assertNativeContainerAudioGeometry({ sampleRate: 44_100, numberOfChannels: 1, length: 4410 }, admission), /geometry/u);
});

test('ordinary supported MP3 never selects a native whole-file fallback', async () => {
	assert.equal(await nativeContainerAudioAdmission(await crcOffsetMp3Fixture('unprotected'), { nativeSampleRate: () => 44_100 }), null);
});

for (const field of ['rate', 'bitrate', 'channel', 'truncated', 'declared-count'] as const) test(`a ${field} mismatch does not enter the free-format fallback`, async () => {
	const bytes = new Uint8Array(await freeFormatMp3Fixture().arrayBuffer());
	if (field === 'rate') bytes[578] = bytes[578]! ^ 4;
	if (field === 'bitrate') bytes[578] = bytes[578]! | 0x10;
	if (field === 'channel') bytes[579] = bytes[579]! & 63;
	if (field === 'declared-count') new DataView(bytes.buffer).setUint32(29, 5);
	const file = new Blob([field === 'truncated' ? bytes.subarray(0, bytes.length - 1) : bytes]);
	assert.equal(await nativeContainerAudioAdmission(file, { nativeSampleRate: () => 48_000 }), null);
});

test('whole-file and declared PCM bounds are enforced before native decode', async () => {
	class Oversized extends Blob { override get size(): number { return 32 * 1024 ** 2 + 1; }
		override slice(): Blob { throw new Error('Oversized inputs must not be read.'); } }
	assert.equal(await nativeContainerAudioAdmission(new Oversized(), { nativeSampleRate: () => 48_000 }), null);
	const bytes = new Uint8Array(await freeFormatMp3Fixture().arrayBuffer()); new DataView(bytes.buffer).setUint32(29, 1_000_000);
	let largest = 0;
	class Measured extends File { override slice(start = 0, end = this.size): Blob {
		largest = Math.max(largest, end - start); return super.slice(start, end);
	} }
	assert.equal(await nativeContainerAudioAdmission(new Measured([bytes], 'Large.mp3'), { nativeSampleRate: () => 48_000 }), null);
	assert.ok(largest <= 4096);
});

test('Cancel retires an outstanding native packet range and preserves the abort reason', { timeout: 2000 }, async () => {
	const original = freeFormatMp3Fixture(), abort = new AbortController();
	let enter: () => void = () => {}; const entered = new Promise<void>(resolve => { enter = resolve; });
	let finish: (value: ArrayBuffer) => void = () => {};
	class Held extends File { override slice(start = 0, end = this.size): Blob {
		const blob = super.slice(start, end);
		if (start === 576 && end - start === 4) blob.arrayBuffer = () => new Promise(resolve => { finish = resolve; enter(); });
		return blob;
	} }
	const task = nativeContainerAudioAdmission(new Held([original], original.name), { signal: abort.signal, nativeSampleRate: () => 48_000 });
	await entered; const reason = new DOMException('Retired free-format import', 'AbortError'); abort.abort(reason);
	await assert.rejects(task, value => value === reason); finish(new ArrayBuffer(4));
});


test('native free-format44.1k frames retain their ordinary alternating padding slots', async () => {
	assert.deepEqual(await nativeContainerAudioAdmission(paddedFreeFormatMp3Fixture(), { nativeSampleRate: () => 48_000 }),
		{ sampleRate: 44_100, decodeSampleRate: 44_100, channelCount: 1, frameCount: 4800 });
});
