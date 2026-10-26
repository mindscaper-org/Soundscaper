/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const mode of ['success', 'locked', 'read-only'] as const) for (const shorter of [false, true]) test(`Bin replacement settles ${shorter ? 'shortfall' : 'immediate'} staging after ${mode}`, async context => {
	const locked = mode === 'locked';
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'old', name: 'Original.wav', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = createAudioClip({ id: 'instance', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	let releaseDeletion = (): void => {}, deletionStarted = false;
	const deletion = new Promise<void>(resolve => { releaseDeletion = resolve; });
	const controllerStore = new Proxy(store, { get(target, key) {
		if (key === 'deleteSource') return async (id: string) => {
			if (locked && shorter && id !== source.storageKey) { deletionStarted = true; await deletion; }
			return store.deleteSource(id);
		};
		const value: unknown = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
	} });
	let lose = (): void => {}, readOnly = false; const lost = new Promise<void>(resolve => { lose = resolve; });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store: controllerStore,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), engine: createMemoryEngine() as unknown as Options['engine'],
		acquireProjectLock: async projectId => ({ projectId, readOnly: projectId === 'replacement' && readOnly,
			method: 'test', ...(projectId === 'replacement' && !readOnly ? { lost } : {}), retryAt: Date.now() + 60_000, release() {} }) });
	context.after(async () => { releaseDeletion(); lose(); await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'replacement', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id], locked })],
		projectBin: { clips: [{ ...clip, id: 'bin', binItemId: 'bin' }] } }));
	const before = controller.project;
	const originalIds = new Set(sourceIds(await store.listSources()));
	const samples = new Float32Array(shorter ? 24_000 : 48_000).fill(.5);
	const bytes = Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, bitDepth: 32, float: true, dither: false }));
	const prepared = await controller.actions.projectBin.prepareReplacement('bin', new File([bytes], 'Replacement.wav', { type: 'audio/wav' }));
	assert.ok(prepared); assert.equal(prepared.requiresChoice, shorter);
	const staged = sourceIds(await store.listSources()).filter(id => !originalIds.has(id)); assert.equal(staged.length, 1);
	const stagedId = staged[0]; assert.ok(stagedId);
	if (mode === 'read-only') {
		readOnly = true; lose();
		for (let attempt = 0; attempt < 100 && !controller.getSnapshot().readOnly; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(controller.getSnapshot().readOnly, true);
		assert.equal(controller.actions.projectBin.applyReplacement(prepared.token, 'keep-spacing'), null);
		for (let attempt = 0; attempt < 100 && await store.getSourceMetadata(stagedId); attempt++) await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(await store.getSourceMetadata(stagedId), null, 'read-only refusal must retire staging too'); return;
	}
	if (locked) {
		assert.throws(() => controller.actions.projectBin.applyReplacement(prepared.token, 'keep-spacing'), /locked/iu);
		assert.equal(controller.project, before);
		if (shorter) {
			for (let attempt = 0; attempt < 100 && !deletionStarted; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
			assert.ok(deletionStarted);
			let disposed = false; const disposing = controller.dispose().then(() => { disposed = true; });
			await new Promise<void>(resolve => setImmediate(resolve));
			assert.equal(disposed, false, 'disposal drains a retired staging token before storage closes');
			releaseDeletion(); await disposing;
			assert.equal(store.memory.sources.has(stagedId), false);
			assert.equal(store.memory.sources.has(source.storageKey), true); return;
		}
		for (let attempt = 0; attempt < 100 && await store.getSourceMetadata(stagedId); attempt++) await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(await store.getSourceMetadata(stagedId), null, 'refused replacement must not retain unreachable protected PCM');
	} else {
		assert.equal(controller.actions.projectBin.applyReplacement(prepared.token, 'keep-spacing'), 'bin');
		assert.ok(await store.getSourceMetadata(stagedId), 'committed replacement audio must remain available');
		assert.equal(controller.project?.clips[0]?.sourceId, stagedId);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
		controller.actions.edit.redo(); assert.equal(controller.project?.clips[0]?.sourceId, stagedId);
	}
	assert.ok(await store.getSourceMetadata(source.storageKey), 'the original recording remains available');
});

function sourceIds(value: unknown): string[] {
	assert.ok(Array.isArray(value));
	return value.map((row: unknown) => {
		assert.ok(row && typeof row === 'object' && 'id' in row && typeof row.id === 'string'); return row.id;
	});
}
