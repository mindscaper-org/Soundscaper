/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectStreamedAudioImportFile } from '../src/common/editor/streamed-audio-content-admission.ts';
import { aacLcM4a44_100Fixture, alacM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

const original = (): Uint8Array<ArrayBuffer> => Uint8Array.from(aacLcM4a44_100Fixture());
const generic = (bytes = original(), name = 'Recording.bin', type = 'application/octet-stream'): File => new File([bytes], name, { type });

for (const [name, type] of [['Recording.bin', 'application/octet-stream'], ['download', ''], ['Recording.m4a', 'audio/mp4']]) {
	test(`File Import gives the existing AAC decoder ownership of ${name}/${type}`, async () => {
		assert.equal(await inspectStreamedAudioImportFile(generic(original(), name, type)), true);
	});
}

test('opaque ISO discovery leaves explicit identities and non-AAC lossless files unchanged', async () => {
	for (const [name, type] of [['Recording.wav', ''], ['Recording.mov', ''], ['Recording.bin', 'audio/wav'], ['Recording.bin', 'video/mp4']]) {
		assert.equal(await inspectStreamedAudioImportFile(generic(original(), name, type)), false);
	}
	assert.equal(await inspectStreamedAudioImportFile(generic(Uint8Array.from(alacM4a48_000Fixture()))), false);
});

interface Box { readonly type: string; readonly offset: number; readonly size: number }
function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
	const result: Box[] = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = start; offset < end;) {
		const size = view.getUint32(offset); assert.ok(size >= 8 && size <= end - offset);
		result.push({ type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), offset, size }); offset += size;
	}
	return result;
}
function atom(type: string, payload = new Uint8Array()): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(8 + payload.length); new DataView(result.buffer).setUint32(0, result.length);
	result.set([...type].map(character => character.charCodeAt(0)), 4); result.set(payload, 8); return result;
}
function join(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0)); let offset = 0;
	for (const value of values) { result.set(value, offset); offset += value.length; } return result;
}

test('opaque AAC discovery refuses ambiguous, fragmented, incomplete and oversized movies', async () => {
	const bytes = original(), inventory = boxes(bytes), movie = inventory.find(box => box.type === 'moov')!;
	const child = boxes(bytes, movie.offset + 8, movie.offset + movie.size).find(box => box.type === 'trak')!;
	const duplicateTrackMovie = atom('moov', join(bytes.subarray(movie.offset + 8, movie.offset + movie.size), bytes.subarray(child.offset, child.offset + child.size)));
	const fragmentedMovie = atom('moov', join(bytes.subarray(movie.offset + 8, movie.offset + movie.size), atom('mvex')));
	for (const changed of [bytes.subarray(0, bytes.length - 1), join(bytes, atom('moov')), join(bytes, atom('mdat', Uint8Array.of(1))),
		join(bytes, atom('moof')), join(bytes.subarray(0, movie.offset), duplicateTrackMovie),
		join(bytes.subarray(0, movie.offset), fragmentedMovie), join(bytes.subarray(0, movie.offset), atom('moov', new Uint8Array(1024 ** 2))),
		join(bytes, new Uint8Array(7)), join(bytes, ...Array.from({ length: 1024 }, () => atom('free')))]) {
		assert.equal(await inspectStreamedAudioImportFile(generic(Uint8Array.from(changed))), false);
	}
	const video = bytes.slice(), handler = Buffer.from(video).indexOf('soun'); assert.ok(handler > 0);
	video.set([...Buffer.from('vide')], handler);
	assert.equal(await inspectStreamedAudioImportFile(generic(video)), false, 'A video handler must not acquire standalone audio ownership.');
	const invalidSize = bytes.slice(); new DataView(invalidSize.buffer).setUint32(0, 1);
	assert.equal(await inspectStreamedAudioImportFile(generic(invalidSize)), false);
});

test('opaque AAC identification bounds reads and skips unrelated encoded payload', async () => {
	let total = 0, largest = 0;
	class Measured extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		total += end - start; largest = Math.max(largest, end - start); return super.slice(start, end, type);
	} }
	const file = new Measured([original(), atom('free', new Uint8Array(4 * 1024 ** 2))], 'Download.bin');
	assert.equal(await inspectStreamedAudioImportFile(file), true);
	assert.ok(largest <= 1024 ** 2); assert.ok(total <= 2 * 1024 ** 2, `Read ${total} bytes from ${file.size}.`);
});

for (const phase of ['headers', 'movie']) test(`Cancel retires opaque AAC ${phase} reads without late traversal`, { timeout: 2000 }, async () => {
	const abort = new AbortController(); let enter = (): void => {}, finish = (_bytes: ArrayBuffer): void => {}, reads = 0;
	const entered = new Promise<void>(resolve => { enter = resolve; }); let held: Blob | null = null;
	class Held extends File { override slice(start = 0, end = this.size, type = ''): Blob {
		reads++; const blob = super.slice(start, end, type);
		if (!held && (phase === 'headers' || end - start > 16)) {
			held = blob; blob.arrayBuffer = () => new Promise(resolve => { finish = resolve; enter(); });
		}
		return blob;
	} }
	const pending = inspectStreamedAudioImportFile(new Held([original()], 'Download.bin'), abort.signal);
	await entered; const reason = new DOMException(`Cancel ${phase}.`, 'AbortError'); abort.abort(reason);
	await assert.rejects(pending, error => error === reason); const retiredReads = reads; finish(new ArrayBuffer(0));
	await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(reads, retiredReads);
});

test('opaque HE-AAC acquires the existing AAC profile without turning its core clock into a native hint', async () => {
	const { opaqueIsoHeAacFixture } = await import('./helpers/opaque-iso-aac-fixture.ts');
	const { inspectDecodedAudioSampleRate } = await import('../src/common/editor/audio-file-metadata.js');
	const bytes = opaqueIsoHeAacFixture();
	assert.equal(await inspectStreamedAudioImportFile(generic(bytes)), true);
	assert.equal(inspectDecodedAudioSampleRate(bytes), null, '24k core is not the reconstructed48k programme clock.');
});
