/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { addAdmEditorObject, createDefaultAdmMetadata, listAdmEditorSourceChannels } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';

for (const mode of ['programme', 'object'] as const) for (const multiline of [false, true]) {
	test(`ADM ${mode} default retains ${multiline ? 'multiline' : 'ordinary'} descriptive names through import and publication`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const name = multiline ? 'Opening\nRoom tone' : 'Opening Room tone';
		const title = mode === 'programme' ? name : 'Ordinary programme';
		const trackName = mode === 'object' ? name : 'Dialogue';
		const source = createAudioSource({ id: 'source', name: 'Room.wav', sampleRate: 48_000, frameCount: 4_800, channelCount: 1 });
		const project = createSoundscaperProject({ id: `adm-custody-${mode}-${multiline}`, metadata: { title }, sources: [source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4_800, sourceDurationFrames: 4_800 })],
			tracks: [createAudioTrack({ id: 'track', name: trackName, clipIds: ['clip'] })],
			sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main' });
		const sender = createMemoryProjectStore(context, `${context.name}-sender`);
		const writer = await sender.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4_800).fill(.2)]); await writer.commit();
		const archives = createSoundscaperScapeNativeRuntime();
		const original = await archives.exportScapeProject(project, sender);
		assert.ok(original.blob);
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: archives,
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: () => { throw new Error('ADM naming must not replace source PCM with a render substitute.'); } });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.project.openScapeFile(new File([original.blob], 'ADM descriptive names.sscape'), () => 'copy');
		const imported: unknown = controller.project;
		assert.ok(validateSoundscaperProject(imported));
		assert.equal(imported.metadata.title, title);
		assert.equal(imported.tracks[0]?.name, trackName);
		await assertSourcePcm(imported, store);

		let before = structuredClone(imported);
		const seed = createDefaultAdmMetadata(imported);
		controller.actions.metadata.update({ adm: seed });
		if (mode === 'object') {
			const enabled: unknown = controller.project;
			assert.ok(validateSoundscaperProject(enabled));
			before = structuredClone(enabled);
			const channel = listAdmEditorSourceChannels(enabled).find(value => value.stripId === 'track' && value.sourceChannel === 0);
			assert.ok(channel);
			controller.actions.metadata.update({ adm: addAdmEditorObject(seed, channel, () => 'object') });
		}
		const published: unknown = controller.project;
		assert.ok(validateSoundscaperProject(published));
		assertNames(published, title, trackName, mode);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.metadata, before.metadata);
		controller.actions.edit.redo();
		assert.deepEqual(controller.project?.metadata, published.metadata);
		await controller.actions.project.flush();
		const persisted: unknown = await store.loadProject(published.id);
		assert.ok(validateSoundscaperProject(persisted));
		assertNames(persisted, title, trackName, mode);

		const exported = await archives.exportScapeProject(controller.project, store);
		assert.ok(exported.blob);
		const recipient = createMemoryProjectStore(context, `${context.name}-recipient`);
		const result = await archives.importScapeProject(exported.blob, recipient);
		assert.equal(result.readOnly, false);
		const reopened: unknown = result.project;
		assert.ok(validateSoundscaperProject(reopened));
		assertNames(reopened, title, trackName, mode);
		await assertSourcePcm(reopened, recipient);
	});
}

function assertNames(project: SoundscaperProject, title: string, trackName: string, mode: 'programme' | 'object'): void {
	assert.equal(project.metadata.title, title, 'ADM defaults leave broader descriptive metadata intact');
	assert.equal(project.tracks[0]?.name, trackName);
	const adm = project.metadata.adm;
	assert.ok(adm?.mode === 'authored');
	assert.equal(adm.programme.name, mode === 'programme' ? 'Opening Room tone' : 'Ordinary programme');
	assert.equal(adm.objects?.length ?? 0, mode === 'object' ? 1 : 0);
	if (mode === 'object') {
		assert.deepEqual(adm.objects?.map(object => ({ name: object.name, stripId: object.stripId, sourceChannel: object.sourceChannel })),
			[{ name: 'Opening Room tone — channel 1', stripId: 'track', sourceChannel: 0 }]);
	}
}

async function assertSourcePcm(project: SoundscaperProject, store: AudioEditorProjectStore): Promise<void> {
	const clip = project.clips[0];
	assert.ok(clip?.kind === 'audio');
	assert.equal(clip.durationFrames, 4_800);
	const source = project.sources.find(value => value.id === clip.sourceId);
	assert.ok(source?.kind === 'audio');
	assert.equal(source.sampleRate, 48_000);
	assert.equal(source.channelCount, 1);
	assert.equal(source.frameCount, 4_800);
	const pcm = await readPcm(store, source.storageKey);
	assert.equal(pcm.length, 1);
	assert.deepEqual(pcm[0], Array<number>(4_800).fill(Math.fround(.2)));
}
