/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { inspectOpusInitialGranule } from '../src/common/editor/opus-initial-granule.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { inspectOggGaplessGeometry } from '../src/common/editor/ogg-gapless-import.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';
import { croppedOpusGranuleFixture } from './helpers/ogg-multiplexed-tail-fixture.ts';

test('File Open normalizes a cropped Opus granule origin without inventing silent audio', async () => {
	const fixture = await croppedOpusGranuleFixture();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (value, init) => value instanceof URL && value.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(value))) : originalFetch(value, init);
	const { store } = await createTwoTrackFixture('next-opus-granule-origin', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		const original = await prepareStreamedAudioImport(new Blob([fixture.original], { type: 'audio/ogg' }));
		const expected = new Float32Array(fixture.frames);
		let offset = 0;
		await original.stream({ chunkFrames: 65_536, onChunk(channels) { expected.set(channels[0]!, offset); offset += channels[0]!.length; } });
		await controller.ready;
		await controller.actions.project.importFiles([new File([fixture.cropped], 'Cropped live stream.opus', { type: 'audio/ogg' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1, 'the valid cropped stream must import through the ordinary file action');
		const source = project.sources[0]!;
		assert.equal(source.frameCount, fixture.frames);
		assert.equal(project.clips[0]?.durationFrames, fixture.frames);
		assert.deepEqual(await storedChannel(store, source.id, 0), expected);
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});

test('a small Opus origin also retains the independently encoded final trimming', async () => {
	const fixture = await croppedOpusGranuleFixture(1);
	assert.deepEqual(await inspectOggGaplessGeometry(new Blob([fixture.cropped]), 'opus'), { sampleRate: 48_000, sourceFrames: fixture.frames });
});


test('an Opus first-and-final audio page retains its short-stream end trim', async () => {
	const pcm = Float32Array.of(.1);
	const bytes = await encodeDedicatedAudioPcm({ format: 'opus', input: new Uint8Array(pcm.buffer), frameCount: 1,
		sampleRate: 48_000, channelCount: 1, settings: { bitrateKbps: 128, vbrMode: 0 }, maximumOutputBytes: 65_536 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	assert.deepEqual(await inspectOggGaplessGeometry(new Blob([bytes]), 'opus'), { sampleRate: 48_000, sourceFrames: 1 });
});

test('the Opus origin uses bounded checked page reads and honors cancellation', async () => {
	const { cropped } = await croppedOpusGranuleFixture();
	const serial = new DataView(cropped.buffer).getUint32(14, true);
	const reads: number[] = [];
	class MeasuredBlob extends Blob {
		override slice(start?: number, end?: number, type?: string): Blob {
			const part = super.slice(start, end, type);
			reads.push(part.size);
			return part;
		}
	}
	assert.equal(await inspectOpusInitialGranule(new MeasuredBlob([cropped]), serial), 480_000);
	assert.ok(reads.every(size => size <= 65_307), 'inspection never materializes the complete encoded source');
	const invalid = Uint8Array.from(cropped);
	let offset = 0;
	while (new DataView(invalid.buffer, offset).getBigUint64(6, true) === 0n) {
		const laces = invalid.subarray(offset + 27, offset + 27 + invalid[offset + 26]!);
		offset += 27 + laces.length + laces.reduce((sum, length) => sum + length, 0);
	}
	invalid[offset + 22] = invalid[offset + 22]! ^ 1;
	await assert.rejects(inspectOpusInitialGranule(new Blob([invalid]), serial), /checksum/u);
	const abort = new AbortController();
	class AbortingBlob extends Blob {
		override slice(start?: number, end?: number, type?: string): Blob {
			abort.abort();
			return super.slice(start, end, type);
		}
	}
	await assert.rejects(inspectOpusInitialGranule(new AbortingBlob([cropped]), serial, abort.signal), { name: 'AbortError' });
});
