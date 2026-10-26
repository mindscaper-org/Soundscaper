/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const [reference, target] of [[' Voice ', 'spaced'], ['Voice', 'plain'], ['  Other  ', 'other'], [' spaced ', 'spaced']] as const) {
	test(`pasted row resolves exact authored track name ${JSON.stringify(reference)}`, async context => {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
		const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'spreadsheet-track-name', sources: [source], tracks: [
			createAudioTrack({ id: 'origin', name: 'Origin', clipIds: ['template'] }), createAudioTrack({ id: 'plain', name: 'Voice' }), createAudioTrack({ id: 'spaced', name: ' Voice ' }),
			createAudioTrack({ id: 'other', name: 'Other' }),
		], clips: [createAudioClip({ id: 'template', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })] });
		const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
		const native = createSoundscaperScapeNativeRuntime(); const archive = await native.exportScapeProject(project, archiveStore);
		assert.ok(archive.blob instanceof Blob); await archiveStore.close();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: native,
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Tracks.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false); const before = controller.project;
		await controller.actions.clip.pasteSpreadsheet('spreadsheet-track-name', [], [{ source: String(controller.project?.sources[0]?.id), track: reference }]);
		const clip = controller.project?.clips.find(clip => clip.id !== 'template'); assert.ok(clip);
		assert.deepEqual(controller.project?.tracks.find(track => track.id === target)?.clipIds, [clip.id]);
		assert.equal(clip.durationFrames, 4800); assert.equal(controller.project?.tracks.length, 4);
		const pcm = await store.readSourceChunk(String(controller.project?.sources[0]?.storageKey), 0); assert.equal(pcm?.channels[0]?.[0], .25);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before?.tracks); assert.deepEqual(controller.project?.clips, before?.clips); assert.deepEqual(controller.project?.sources, before?.sources);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks.find(track => track.id === target)?.clipIds, [clip.id]);
	});
}
