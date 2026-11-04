/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoAudioWorkloadReader } from '../src/common/editor/controller/import/internal/video-import-audio-workload.ts';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { videoAudioRouteWorkloadFixture } from './browser/fixtures/video-audio-route-workload-fixture.ts';

test('video import admits every native audio programme with one bounded movie read', async () => {
	const file = videoAudioRouteWorkloadFixture('shared-long', [2, 2]);
	const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
	let movieStart = 0, movieEnd = 0;
	for (let offset = 0; offset < bytes.length;) {
		const length = view.getUint32(offset);
		if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'moov') {
			movieStart = offset + 8; movieEnd = offset + length; break;
		}
		offset += length;
	}
	assert.ok(movieEnd - movieStart > 512 * 1024);
	let movieReads = 0;
	class Counted extends Blob {
		override slice(start?: number, end?: number, type?: string): Blob {
			if (start === movieStart && end === movieEnd) movieReads++;
			return super.slice(start, end, type);
		}
	}
	const calls: string[] = [], decoded = { channels: [Float32Array.of(.25)], sampleRate: 8_000 };
	const result = await decodeImportedVideoAudio({
		file: new Counted([file]), hasAudio: true, durationSeconds: 2,
		projectSampleRate: 8_000, nativeContextSampleRate: 8_000,
		inspectEncodedSampleRate: () => null,
		async decodeNative() { calls.push('native'); return decoded; },
		async decodeContainerAudio() { assert.fail('The admitted native route must remain selected.'); },
		async decodeFfmpeg() { assert.fail('The admitted native route must remain selected.'); },
	});
	assert.deepEqual(calls, ['native']);
	assert.equal(result.decodedAudio, decoded);
	assert.equal(movieReads, 1, 'Primary and candidate programmes must reuse the same bounded movie inspection.');
});

test('the workload reader reuses only the selected programme and retires cached admissions on abort', async () => {
	const abort = new AbortController();
	let reads = 0;
	class Counted extends Blob {
		override slice(start?: number, end?: number, type?: string): Blob {
			reads++; return super.slice(start, end, type);
		}
	}
	const reader = await createVideoAudioWorkloadReader(new Counted([
		videoAudioRouteWorkloadFixture('first-long', [1, 2]),
	]), abort.signal);
	try {
		const primary = await reader.read(); assert.ok(primary);
		assert.equal(primary.presentationEndSeconds, 2);
		const afterPrimary = reads;
		assert.equal(await reader.read(1), primary);
		assert.equal(reads, afterPrimary, 'A repeated track selection must not repeat metadata reads.');
		const first = await reader.read('first'); assert.ok(first);
		assert.equal(first.presentationEndSeconds, 1);
		assert.ok(first.codedFrameCount > primary.codedFrameCount);
		assert.ok(Object.isFrozen(primary));
		const afterFirst = reads;
		const reason = new DOMException('Import retired', 'AbortError'); abort.abort(reason);
		await assert.rejects(reader.read(), error => error === reason);
		assert.equal(reads, afterFirst, 'A retired admission cannot reopen its source.');
	} finally { reader.dispose(); reader.dispose(); }
});

test('disposing a workload reader closes every programme lookup', async () => {
	const reader = await createVideoAudioWorkloadReader(videoAudioRouteWorkloadFixture('first-long'));
	reader.dispose(); reader.dispose();
	await assert.rejects(reader.read(), /disposed/u);
});

test('separate import readers never reuse another selection or authored presentation', async () => {
	const short = await createVideoAudioWorkloadReader(videoAudioRouteWorkloadFixture('first-long', [1, 2]));
	const long = await createVideoAudioWorkloadReader(videoAudioRouteWorkloadFixture('first-long', [1, 5]));
	try {
		assert.equal((await short.read())?.presentationEndSeconds, 2);
		assert.equal((await long.read())?.presentationEndSeconds, 5);
	} finally { short.dispose(); long.dispose(); }
});

test('disposing during a held edit read rejects admission and fences late metadata reads', async () => {
	let hold = false, reads = 0;
	let release!: () => void, entered!: () => void;
	const held = new Promise<void>(resolve => { entered = resolve; });
	class Held extends Blob {
		override slice(start?: number, end?: number, type?: string): Blob {
			reads++;
			const part = super.slice(start, end, type);
			if (hold && end !== undefined && end - (start ?? 0) <= 32) {
				hold = false;
				const arrayBuffer = part.arrayBuffer.bind(part);
				part.arrayBuffer = async () => {
					await new Promise<void>(resolve => { release = resolve; entered(); });
					return arrayBuffer();
				};
			}
			return part;
		}
	}
	const reader = await createVideoAudioWorkloadReader(new Held([videoAudioRouteWorkloadFixture('first-long')]));
	hold = true;
	const pending = reader.read();
	const rejected = assert.rejects(pending, /disposed/u);
	await held;
	reader.dispose();
	await rejected;
	const retiredReads = reads;
	release();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(reads, retiredReads, 'The released read must not start another metadata request.');
});
