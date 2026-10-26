/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readMatroskaOpusEndPadding } from '../src/common/editor/matroska-opus-end-padding.ts';
import { decodeBrowserContainerAudio, type BrowserContainerAudioSample } from '../src/common/editor/browser-container-audio-decode.ts';
import { opusPaddingAvFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

test('the actual FFmpeg WebM final Opus packet retains its exact648-frame padding', async () => {
	assert.equal(await readMatroskaOpusEndPadding(opusPaddingAvFixture(), 2), 648);
	assert.equal(await readMatroskaOpusEndPadding(opusPaddingAvFixture(), 1), 0);
	assert.equal(await readMatroskaOpusEndPadding(new Blob(['ordinary non-Matroska bytes']), 2), 0);
});

test('large Void bytes are skipped without materializing the video or padding body', async () => {
	const source = opusPaddingAvFixture(32 * 1024 ** 2); let reads = 0, bytes = 0;
	class BoundedBlob extends Blob {
		override slice(start = 0, end = this.size, type = ''): Blob {
			assert.ok(end - start <= 16); reads++; bytes += end - start;
			return super.slice(start, end, type);
		}
	}
	assert.equal(await readMatroskaOpusEndPadding(new BoundedBlob([source]), 2), 648);
	assert.ok(reads < 100); assert.ok(bytes < 1500);
});

test('padding larger than the final packet is refused before any PCM trim', async () => {
	const bytes = new Uint8Array(await opusPaddingAvFixture().arrayBuffer());
	const index = Buffer.from(bytes).indexOf(Buffer.from([0x75, 0xa2])); assert.ok(index > 0); assert.equal(bytes[index + 2], 0x84);
	new DataView(bytes.buffer).setInt32(index + 3, 21_000_000);
	await assert.rejects(readMatroskaOpusEndPadding(new Blob([bytes]), 2), /padding exceeds.*packet/u);
});

test('unknown-size live Segment and Cluster retain the same final packet authority', async () => {
	const bytes = new Uint8Array(await opusPaddingAvFixture().arrayBuffer());
	for (const marker of [[0x18, 0x53, 0x80, 0x67], [0x1f, 0x43, 0xb6, 0x75]]) {
		const index = Buffer.from(bytes).lastIndexOf(Buffer.from(marker)); assert.ok(index > 0);
		let width = 1; while (!(bytes[index + 4]! & (1 << (8 - width)))) width++;
		bytes.fill(255, index + 4, index + 4 + width); bytes[index + 4] = 2 ** (9 - width) - 1;
	}
	assert.equal(await readMatroskaOpusEndPadding(new Blob([bytes]), 2), 648);
});

test('a pending native padding read releases its owner on Cancel', async () => {
	const abort = new AbortController(); let entered: (() => void) | undefined, release: (() => void) | undefined;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const held = new Promise<void>(resolve => { release = resolve; });
	class PendingBlob extends Blob {
		override slice(start = 0, end = this.size, type = ''): Blob {
			const part = super.slice(start, end, type), read = part.arrayBuffer.bind(part);
			part.arrayBuffer = async () => { entered?.(); await held; return read(); }; return part;
		}
	}
	const operation = readMatroskaOpusEndPadding(new PendingBlob([opusPaddingAvFixture()]), 2, abort.signal);
	await started; const reason = new DOMException('Stop padding read.', 'AbortError'); abort.abort(reason);
	try { await assert.rejects(operation, error => error === reason); } finally { release?.(); }
});

for (const duration of [4, 9, 12]) test(`Opus padding preserves a picture window of${String(duration)} frames`, async () => {
	let closed = 0, disposed = 0;
	const packets = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 99, 99]];
	const samples = async function* (): AsyncGenerator<BrowserContainerAudioSample> {
		for (const [index, packet] of packets.entries()) yield {
			timestamp: index * 4 / 48_000, sampleRate: 48_000, numberOfChannels: 1, numberOfFrames: 4, duration: 4 / 48_000,
			copyTo(target, options) { target.set(packet.slice(options.frameOffset ?? 0, (options.frameOffset ?? 0) + (options.frameCount ?? 4))); },
			close() { closed++; },
		};
	};
	const decoded = await decodeBrowserContainerAudio(new Blob(['video']), { durationSeconds: duration / 48_000,
		openSession: () => Promise.resolve({ sampleRate: 48_000, channelCount: 1, timelineOrigin: 0, endPaddingFrames: 2,
			samples, dispose() { disposed++; } }),
	});
	assert.deepEqual([...decoded.channels[0]!], Array.from({ length: duration }, (_, index) => index < 10 ? index + 1 : 0));
	assert.equal(disposed, 1); assert.equal(closed, duration === 4 ? 2 : 3);
});
