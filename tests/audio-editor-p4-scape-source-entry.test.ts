/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { safeScapeEntryId } from '../src/common/editor/scape-archive-media.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { rewriteScapeManifest, rewriteScapeProjectDocument } from './helpers/scape-archive-rewrite.js';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const id of ['\ud800', '\udfff', '🎵', 'Voice']) test(`native File Open and Save preserve source identity ${JSON.stringify(id)}`, async context => {
	const seed = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:seed` });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const fresh = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:fresh` });
	context.after(async () => { await seed.close(); await fresh.close(); });
	const ids = [id, '%ud800', '_ud800', '%udfff', '_udfff'];
	const mapping = new Map(ids.map((next, index) => [`original-${index}`, next]));
	const sources = ids.map((_, index) => createAudioSource({ id: `original-${index}`, name: `Recording ${index}.wav`,
		frameCount: 4, sampleRate: 48_000, channelCount: 1 }));
	for (const [index, source] of sources.entries()) {
		const writer = await seed.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4).fill((index + 1) / 8)]); await writer.commit();
	}
	const project = createSoundscaperProject({ id: 'source-entry', sources, clips: sources.map((source, index) => createAudioClip({
		id: `clip-${index}`, sourceId: source.id, timelineStartFrame: index * 4, sourceDurationFrames: 4, durationFrames: 4,
	})), tracks: [createAudioTrack({ id: 'voice', clipIds: sources.map((_, index) => `clip-${index}`) })] });
	const original = await exportScapeProject(project, seed); assert.ok(original.blob);
	const archive = await rewriteScapeManifest(await rewriteScapeProjectDocument(original.blob,
		(document: { sources: { id: string; storageKey: string }[]; clips: { sourceId: string }[] }) => {
			for (const source of document.sources) source.storageKey = source.id = mapping.get(source.id)!;
			for (const clip of document.clips) clip.sourceId = mapping.get(clip.sourceId)!;
		}), (manifest: { assets: { sourceId: string }[] }) => {
			for (const asset of manifest.assets) asset.sourceId = mapping.get(asset.sourceId)!;
		});
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive], 'Source identities.sscape'), () => 'copy');
	const opened: unknown = controller.project; assert.ok(validateSoundscaperProject(opened));
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.deepEqual(opened.sources.map(source => source.id), ids);
	for (const [index, source] of opened.sources.entries()) assertPcmSamplesEqual(
		(await store.readSourceChunk(source.storageKey, 0))?.channels[0], new Float32Array(4).fill((index + 1) / 8));
	const saved = await exportScapeProject(opened, store); assert.ok(saved.blob);
	assert.equal(new Set(saved.manifest.assets.map(asset => asset.entry)).size, ids.length);
	const restored = await createSoundscaperScapeNativeRuntime().importScapeProject(saved.blob, fresh);
	const restoredProject: unknown = restored.project; assert.ok(validateSoundscaperProject(restoredProject));
	assert.deepEqual(restoredProject.sources.map(source => source.id), ids);
	for (const [index, source] of restoredProject.sources.entries()) assertPcmSamplesEqual(
		(await fresh.readSourceChunk(source.storageKey, 0))?.channels[0], new Float32Array(4).fill((index + 1) / 8));
});

// The path component is opaque: native source identity remains in project/manifest JSON.
test('native source entry names preserve existing spellings and distinguish UTF-16 escape lookalikes', () => {
	for (const [id, expected] of [
		['Voice', 'Voice'], ['é', '_C3_A9'], ['🎵', '_F0_9F_8E_B5'],
		['.', '_2E'], ['..', '_2E_2E'], ['/Voice', '_2FVoice'],
		['\ud800', '_ud800'], ['\udfff', '_udfff'], ['%ud800', '_25ud800'],
		['_ud800', '_5Fud800'], ['\\ud800', '_5Cud800'],
	] as const) assert.equal(safeScapeEntryId(id), expected, JSON.stringify(id));
	const ids = ['\ud800', '\udfff', '\ud800\udfff', '%ud800', '_ud800', '%udfff', '_udfff'];
	assert.equal(new Set(ids.map(safeScapeEntryId)).size, ids.length);
});
