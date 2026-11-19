/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { planTrackListRows } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const foldered of [false, true]) test(`native derived-track order accounts for ${foldered ? 'folder' : 'root'} placement`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false, databaseName: `round7-derived-placement-${foldered}` });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const clipIds: string[] = [], trackIds: string[] = [];
	for (let index = 0; index < 2; index += 1) {
		const trackId = controller.actions.track.add({ name: ['Alpha', 'Bravo'][index]! });
		assert.ok(trackId);
		controller.actions.timeline.selectTrack(trackId);
		await controller.actions.generators.generate('tone', { durationSeconds: .2, channelCount: 1,
			amplitude: .25, frequency: 440 });
		const clipId = controller.getSnapshot().selectedClipId;
		assert.ok(clipId);
		clipIds.push(clipId); trackIds.push(trackId);
	}
	if (foldered) controller.actions.trackFolders.wrapSelection(trackIds);
	const ordered = (project = controller.getSnapshot().project!) => {
		const tracks = project.tracks ?? [];
		const names = new Map(tracks.map(track => [track.id, 'name' in track ? track.name : null]));
		return planTrackListRows(createDocumentTrackFolderSnapshot(project), tracks).entries
			.flatMap(row => row.kind === 'track' ? [names.get(row.trackId)] : []);
	};
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Bravo']);
	controller.actions.timeline.setExactSelection(0, 9600, { trackIds: [trackIds[0]!] });
	controller.actions.edit.splitIntoNewTrack();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Alpha 2', 'Bravo']);
	controller.actions.edit.undo();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Bravo']);
	controller.actions.timeline.setExactSelection(0, 9600, { trackIds });
	controller.actions.edit.splitIntoNewTrack();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Alpha 2', 'Bravo', 'Bravo 2']);
	assert.equal(controller.getSnapshot().project!.clips?.length, 2);
	controller.actions.edit.undo();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Bravo']);
	controller.actions.edit.redo();
	assert.deepEqual(ordered(), ['Track 1', 'Alpha', 'Alpha 2', 'Bravo', 'Bravo 2']);
	const finalProject = controller.project;
	assert.ok(validateSoundscaperProject(finalProject));
	const senderPCM = new Map(await Promise.all(finalProject.sources.map(async source =>
		[source.id, (await readPcm(store, source.storageKey)).map(channel => Float32Array.from(channel))] as const)));
	const archive = createSoundscaperScapeNativeRuntime();
	const exported = await archive.exportScapeProject(finalProject, store); assert.ok(exported.blob);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const reopened = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false); assert.ok(validateSoundscaperProject(reopened.project));
	assert.deepEqual(ordered(reopened.project), ['Track 1', 'Alpha', 'Alpha 2', 'Bravo', 'Bravo 2']);
	assert.equal(reopened.project.clips.length, 2);
	assert.equal(reopened.project.sources.length, 2);
	for (const source of reopened.project.sources) {
		assert.ok(source.kind === 'audio');
		const originalSource: SoundscaperProject['sources'][number] | undefined = finalProject.sources.find(candidate => candidate.id === source.id); assert.ok(originalSource);
		assert.deepEqual([source.sampleRate, source.channelCount, source.frameCount], [48_000, 1, 9600]);
		const expected = senderPCM.get(originalSource.id); assert.ok(expected);
		assertPcmChannelsEqual((await readPcm(recipient, source.storageKey)).map(channel => Float32Array.from(channel)), expected);
	}
});
