/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { createController, createTwoTrackFixture, storedSample } from './helpers/audio-editor-multitrack-selection-harness.js';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

for (const container of ['RF64', 'BW64'] as const) test(`File Open retains ${container} INFO and trailing ID3 metadata beside its PCM`, async () => {
	const samples = Float32Array.of(0.25, -0.25, 0.5, -0.5);
	const bytes = Uint8Array.from(encodeWav([samples], { container: 'bw64', sampleRate: 48_000, dither: false,
		metadata: { title: 'Field take', artist: 'Ada', lyrics: 'The complete words', composer: 'Composer' } }));
	bytes.set(new TextEncoder().encode(container));
	if (container === 'RF64') new DataView(bytes.buffer).setBigUint64(36, BigInt(samples.length), true);
	const { store } = await createTwoTrackFixture(`next-${container}`, new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([bytes], `${container}.wav`, { type: 'audio/wav' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(project);
		assert.ok(Array.isArray(project.sources));
		const sources: readonly unknown[] = project.sources;
		assert.equal(sources.length, 1, 'the maintained PCM reader must successfully publish the recording');
		const source = sources[0];
		assert.ok(source && typeof source === 'object' && 'provenance' in source && 'id' in source);
		assert.equal(typeof source.id, 'string');
		if (typeof source.id !== 'string') throw new TypeError('Expected the native imported source ID.');
		assert.equal(await storedSample(store, source.id, 0), 0.25);
		const provenance = normalizeSourceProvenance(source.provenance, 'imported source');
		assert.equal(provenance.contributions[0]?.metadata.normalized.title, 'Field take');
		assert.equal(provenance.contributions[0]?.metadata.normalized.artist, 'Ada');
		assert.equal(provenance.contributions[0]?.metadata.normalized.lyrics, 'The complete words');
		assert.equal(provenance.contributions[0]?.metadata.raw.TCOM, 'Composer');
		assert.deepEqual(provenance.contributions[0]?.warnings, []);
	} finally { await controller.dispose(); }
});

test('RIFF64 metadata reads skip the complete PCM payload', async () => {
	const bytes = Uint8Array.from(encodeWav([new Float32Array(65_536)], {
		container: 'bw64', metadata: { lyrics: 'After the audio' },
	}));
	const descriptor = await inspectWavBlobPcm(new Blob([bytes]));
	const reads: Array<readonly [number, number]> = [];
	class TrackedFile extends File {
		override slice(start = 0, end = this.size, type?: string): Blob {
			reads.push([start, end]);
			return super.slice(start, end, type);
		}
	}
	const inspected = await inspectImportedMediaMetadata(new TrackedFile([bytes], 'Large.wav'));
	assert.equal(inspected.metadata.normalized?.lyrics, 'After the audio');
	assert.ok(reads.every(([start, end]) => end <= descriptor.dataOffset || start >= descriptor.dataOffset + descriptor.dataByteLength),
		'metadata inspection must not read or construct a slice containing PCM');
});
