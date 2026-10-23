/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAiff } from '../src/common/editor/aiff.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedSample } from './helpers/audio-editor-multitrack-selection-harness.js';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';

const metadata = { title: 'Reviewed recording', artist: 'Ada', album: 'Field sessions', genre: 'Ambient',
	composer: 'Éva', copyright: '© 2026 Ada', publisher: 'Reviewed studio', track: '3/9', year: '2026' };
for (const format of ['wav', 'aiff', 'aifc'] as const) test(`File Import retains standard descriptive ID3 fields from exported ${format}`, async () => {
	const options = { sampleRate: 48_000, bitDepth: 24 as const, float: format === 'aifc', dither: false, metadata };
	const pcm = [new Float32Array(4800).fill(.25)];
	const bytes = format === 'wav' ? encodeWav(pcm, options) : encodeAiff(pcm, options);
	assert.ok(bytes instanceof Uint8Array);
	const { store } = await createTwoTrackFixture(`aiff-descriptive-${format}`, new Map<string, Float32Array>(), 48_000);
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: createMemoryEngine() as unknown as Options['engine'] });
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([Uint8Array.from(bytes)], `Recording.${format}`, { type: format === 'wav' ? 'audio/wav' : 'audio/aiff' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project; assert.ok(project && Array.isArray(project.sources));
		const sources: readonly unknown[] = project.sources; assert.equal(sources.length, 1);
		const source = sources[0]; assert.ok(source && typeof source === 'object' && 'provenance' in source && 'id' in source && typeof source.id === 'string');
		assert.ok(Math.abs(await storedSample(store, source.id, 0) - .25) < 1e-6);
		const origin = normalizeSourceProvenance(source.provenance, 'Imported ID3').contributions[0]; assert.ok(origin);
		assert.deepEqual(origin.metadata.normalized, { title: metadata.title, artist: metadata.artist, album: metadata.album, genre: metadata.genre,
			trackNumber: 3, tracksTotal: 9, date: '2026-01-01T00:00:00.000Z' });
	} finally { await controller.dispose(); }
});
