/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAiffBlobPcmChunkReader } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { inspectDesktopStandalonePcm } from '../src/common/editor/controller/import/internal/desktop-standalone-pcm-import.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';

for (const extension of ['aif', 'aifc']) test(`ordinary uncompressed AIFF-C ${extension} retains its native samples through import and Scape reopen`, async context => {
	const encoded = await readFile(new URL('./fixtures/python-uncompressed.aif.base64', import.meta.url), 'ascii');
	const bytes = Buffer.from(encoded, 'base64');
	const file = new File([bytes], `ordinary-tone.${extension}`, { type: 'audio/x-aiff' });
	const descriptor = await inspectDesktopStandalonePcm(file, {}, null);
	assert.ok(descriptor, 'both ordinary AIFF-C suffixes use the bounded reader');
	const reader = createAiffBlobPcmChunkReader(file, { descriptor, chunkFrames: 97 });
	assert.equal(reader.descriptor.container, 'aifc');
	assert.equal(reader.descriptor.encoding, 'pcm-integer');
	assert.equal(reader.descriptor.sampleRate, 8_000);
	assert.equal(reader.descriptor.frameCount, 8_000);
	assert.equal(reader.descriptor.channelCount, 1);
	const first = await reader.readChunk(0);
	for (let frame = 0; frame < first.frames; frame += 1) {
		const expected = Math.round(8192 * Math.sin(2 * Math.PI * 440 * frame / 8000)) / 32768;
		assert.equal(first.channels[0]?.[frame], expected);
	}
	const last = await reader.readChunk(reader.chunkCount - 1);
	assert.equal(last.final, true);
	assert.equal(last.frameOffset + last.frames, 8_000);
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.importFiles([file]);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips.length, 1);
	const archive = createSoundscaperScapeNativeRuntime();
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const exported = await archive.exportScapeProject(project, store); assert.ok(exported.blob);
	const reopened = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false);
	const restoredProject: unknown = reopened.project; assert.ok(validateSoundscaperProject(restoredProject));
	assert.equal(restoredProject.sources.length, 1); assert.equal(restoredProject.clips.length, 1);
	const source = restoredProject.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.sampleRate, 8000); assert.equal(source.frameCount, 8000); assert.equal(source.channelCount, 1);
	const origin = normalizeSourceProvenance(source.provenance).contributions[0]?.origin;
	assert.ok(origin?.kind === 'local-file'); assert.equal(origin.originalFileName, file.name);
	const samples: number[] = [];
	for await (const chunk of recipient.readSourceChunks(source.storageKey)) {
		assert.ok(chunk.channels[0]); samples.push(...chunk.channels[0]);
	}
	// Integer PCM has one zero representation; Math.round can produce -0.
	const expected = Array.from({ length: 8000 }, (_, frame) => Math.round(8192 * Math.sin(2 * Math.PI * 440 * frame / 8000)) / 32768 || 0);
	assertPcmSamplesEqual(samples, expected);
});
