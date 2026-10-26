/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { aiffWithRepeatedAnnotations } from './helpers/next200-aiff-metadata-fixture.ts';

class TrackedAiff extends File {
	metadataPayloadBytes = 0;
	override slice(start?: number, end?: number, type?: string): Blob {
		const blob = super.slice(start, end, type);
		if (blob.size >= 32 * 1024) this.metadataPayloadBytes += blob.size;
		return blob;
	}
}

// Keep both the 512-entry and 17 MiB aggregate boundaries with at most 19 MiB input.
for (const count of [513, 18, 16, 2]) test(`File Import retains PCM while bounding ${count} individually admitted AIFF annotations`, async context => {
	const original = aiffWithRepeatedAnnotations(count, count === 513 ? 36 * 1024 : 1024 * 1024);
	const file = new TrackedAiff([original], original.name, { type: original.type });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.importFiles([file]);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips.length, 1);
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 4800, 1]);
	const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk);
	assertPcmSamplesEqual(chunk.channels[0], new Float32Array(4800).fill(.25));
	const contribution = source.provenance?.contributions[0]; assert.ok(contribution);
	assert.equal(contribution.metadata.normalized?.title, 'Retained title');
	assert.ok(file.metadataPayloadBytes <= 17 * 1024 * 1024,
		`optional metadata payload reads must share one budget; observed ${file.metadataPayloadBytes} bytes`);
	assert.equal(contribution.warnings.some(warning => warning.includes('aggregate')), count > 17);
	await controller.actions.project.flush();
	const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
	assert.deepEqual(saved.sources, project.sources);
});

test('metadata aggregate admission preserves AbortError without later reads', async () => {
	const file = aiffWithRepeatedAnnotations(2), cancellation = new AbortController();
	cancellation.abort();
	await assert.rejects(inspectImportedMediaMetadata(file, { signal: cancellation.signal }), { name: 'AbortError' });
});
