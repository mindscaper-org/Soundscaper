/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BlobSource, Input, OGG } from 'mediabunny';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { inspectOggGaplessGeometry } from '../src/common/editor/ogg-gapless-import.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';
import { multiplexedOpusFixture } from './helpers/ogg-multiplexed-tail-fixture.ts';

test('File Open retains primary Ogg audio whose EOS precedes a longer secondary stream', async () => {
	const fixture = await multiplexedOpusFixture();
	const file = new File([fixture.multiplexed], 'Two languages.opus', { type: 'audio/ogg' });
	const input = new Input({ source: new BlobSource(file), formats: [OGG] });
	try {
		const tracks = await input.getAudioTracks();
		assert.equal(tracks.length, 2, 'both real streams are independently recognized by the maintained demuxer');
		assert.equal((await input.getPrimaryAudioTrack())?.id, tracks[0]?.id);
		assert.ok(await tracks[1]!.computeDuration() > 20);
	} finally { input.dispose(); }
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (value, init) => value instanceof URL && value.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(value))) : originalFetch(value, init);
	const { store } = await createTwoTrackFixture('next-ogg-primary-end', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		const reference = await prepareStreamedAudioImport(new File([fixture.primary], 'Primary.opus', { type: 'audio/ogg' }));
		const expected = new Float32Array(fixture.frames);
		let offset = 0;
		await reference.stream({ chunkFrames: 65_536, onChunk(channels) { expected.set(channels[0]!, offset); offset += channels[0]!.length; } });
		await controller.ready;
		await controller.actions.project.importFiles([file], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1, 'the ordinary import must publish its primary audio');
		const source = project.sources[0]!;
		assert.equal(source.frameCount, fixture.frames);
		assert.equal(project.clips[0]?.durationFrames, fixture.frames);
		assert.deepEqual(await storedChannel(store, source.id, 0), expected);
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});

test('earlier primary Ogg EOS retains checksum validation', async () => {
	const fixture = await multiplexedOpusFixture();
	const bytes = fixture.multiplexed;
	const serial = new DataView(bytes.buffer).getUint32(14, true);
	let corrupted = false;
	for (let offset = 0; offset < bytes.length;) {
		let size = 27 + bytes[offset + 26]!;
		for (let index = 0; index < bytes[offset + 26]!; index++) size += bytes[offset + 27 + index]!;
		if (bytes[offset + 5]! & 4 && new DataView(bytes.buffer).getUint32(offset + 14, true) === serial) {
			bytes[offset + 22]! ^= 1; corrupted = true; break;
		}
		offset += size;
	}
	assert.ok(corrupted);
	await assert.rejects(inspectOggGaplessGeometry(new Blob([bytes]), 'opus'), /checksum failed/u);
});

test('primary Ogg EOS fallback reads bounded headers and honors cancellation', async () => {
	const fixture = await multiplexedOpusFixture();
	const slices: Array<readonly [number, number]> = [];
	class InspectedBlob extends Blob {
		override slice(start = 0, end = this.size, type?: string): Blob {
			slices.push([start, end]);
			return super.slice(start, end, type);
		}
	}
	const file = new InspectedBlob([fixture.multiplexed]);
	assert.deepEqual(await inspectOggGaplessGeometry(file, 'opus'), { sampleRate: 48_000, sourceFrames: fixture.frames });
	const fallback = slices.slice(2);
	assert.ok(fallback.slice(0, -1).every(([start, end]) => end - start <= 282),
		'the fallback reads only fixed page headers and lacing before its matching EOS');
	assert.ok(fallback.at(-1)![1] - fallback.at(-1)![0] <= 65_307, 'only the matched EOS body is read for CRC');
	const abort = new AbortController();
	class CancelledBlob extends Blob {
		override slice(start = 0, end = this.size, type?: string): Blob {
			if (start === 0 && end === 27) abort.abort(new DOMException('Cancelled page scan.', 'AbortError'));
			return super.slice(start, end, type);
		}
	}
	await assert.rejects(inspectOggGaplessGeometry(new CancelledBlob([fixture.multiplexed]), 'opus', abort.signal), /Cancelled page scan/u);
});
