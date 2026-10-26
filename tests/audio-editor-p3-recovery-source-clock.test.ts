/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { bindSoundscaperProjectRecovery, hasSoundscaperStartupRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { inspectSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-service.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const physicalRate of [48_000, 768_000]) for (const damaged of [false, true]) {
	test(`Recover verifies physical ${String(physicalRate)} Hz PCM clock damaged=${String(damaged)}`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const sources = [createAudioSource({ id: 'clock', frameCount: 4, sampleRate: physicalRate, channelCount: 1 }),
			createAudioSource({ id: 'peer', frameCount: 4, sampleRate: 48_000, channelCount: 1 })];
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([Float32Array.of(.25, -.25, .5, -.5)]); await writer.commit();
		}
		const clips = sources.map(source => createAudioClip({ id: source.id, sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 }));
		const original = createSoundscaperProject({ id: 'clock-recovery', sources, clips,
			tracks: sources.map(source => createAudioTrack({ id: source.id, clipIds: [source.id] })) });
		await store.saveProject(original);
		const stored = structuredClone(original) as unknown as Record<string, unknown>;
		assert.ok(Array.isArray(stored.sources)); const source: unknown = stored.sources[0]; assert.ok(record(source));
		if (damaged) source.sampleRate = physicalRate === 48_000 ? 96_000 : 384_000;
		stored.revision = 100; store.memory.projects.set(original.id, stored);
		assert.equal(await hasSoundscaperStartupRecovery(store, original.id, new Error('Audio engine activation failed.')), damaged);
		const recovery = bindSoundscaperProjectRecovery(store, project => controller.actions.project.open(project), controller);
		const inspection = await recovery.inspect(original.id);
		assert.equal(inspection.candidates[0]?.status, damaged ? 'repairable' : 'usable');
		const result = await recovery.recover(inspection, 0); assert.ok(validateSoundscaperProject(result.project));
		assert.equal(controller.project?.id, result.project.id); assert.equal(controller.getSnapshot().readOnly, false);
		assert.deepEqual(result.project.sources, damaged ? [sources[1]] : sources);
		assert.deepEqual(result.project.clips, damaged ? [clips[1]] : clips);
		assert.deepEqual(store.memory.projects.get(original.id), stored, 'the damaged saved row is never rewritten');
		const bytes: number[] = [];
		for await (const chunk of store.readSourceChunks('clock')) bytes.push(...chunk.channels[0]!);
		assert.deepEqual(bytes, [.25, -.25, .5, -.5], 'recovery never deletes the original PCM');
		const retained = await recovery.inspect(original.id);
		const goodIndex = retained.candidates.findIndex(candidate => candidate.kind === 'revision' && candidate.revision === 0);
		assert.ok(goodIndex >= 0); assert.equal(retained.candidates[goodIndex]?.status, 'usable', 'a bad current clock cannot poison the retained revision availability cache');
		const prior = await recovery.recover(retained, goodIndex); assert.deepEqual(prior.project.sources, sources);
	});
}

test('a temporary physical metadata failure blocks recovery instead of proposing media deletion', async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	context.after(async () => { await store.close(); });
	const source = createAudioSource({ id: 'voice', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.id, source); await writer.write([new Float32Array(4)]); await writer.commit();
	const project = createSoundscaperProject({ id: 'metadata-read-failure', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	await store.saveProject(project);
	store.getSourceMetadata = async () => { throw new DOMException('The PCM storage database is unavailable.', 'InvalidStateError'); };
	await assert.rejects(inspectSoundscaperProjectRecovery(store, project.id), /database is unavailable/u);
	assert.deepEqual(store.memory.projects.get(project.id), project);
});

test('legacy PCM metadata retains the reader\'s established 48 kHz default', async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	context.after(async () => { await store.close(); });
	const source = createAudioSource({ id: 'legacy', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.id, source); await writer.write([new Float32Array(4)]); await writer.commit();
	const project = createSoundscaperProject({ id: 'legacy-clock', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	await store.saveProject(project);
	const stored: unknown = store.memory.sources.get(source.id); assert.ok(record(stored)); delete stored.sampleRate;
	const inspection = await inspectSoundscaperProjectRecovery(store, project.id);
	assert.equal(inspection.candidates[0]?.status, 'usable');
});

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
