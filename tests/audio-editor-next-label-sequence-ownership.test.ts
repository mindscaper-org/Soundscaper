/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const existing of [false, true]) test(`NP034: ordinary Add label keeps the focused sequence; own label exists=${existing}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const project = createSoundscaperProject({ id: 'label-sequences', tracks: [
		...(existing ? [{ id: 'own-labels', name: 'Own labels', type: 'label', labels: [] }] : []),
		createAudioTrack({ id: 'voice', name: 'Voice' }), { id: 'foreign-labels', name: 'Foreign labels', type: 'label', labels: [] },
	], sequences: [{ id: 'main', trackIds: [...(existing ? ['own-labels'] : []), 'voice'] },
		{ id: 'other', trackIds: ['foreign-labels'] }], primarySequenceId: 'main' });
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Label ownership.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.selectTrack('voice');
	const before = controller.project; controller.actions.labels.add();
	const result: unknown = controller.project; assert.ok(validateSoundscaperProject(result));
	const ownTrackIds = new Set(result.sequences.find(sequence => sequence.id === 'main')?.trackIds);
	const labeled = result.tracks.filter(track => Array.isArray(track.labels) && track.labels.length === 1);
	assert.equal(labeled.length, 1); assert.ok(ownTrackIds.has(labeled[0]!.id), 'a label belongs to the focused audio sequence');
	controller.actions.edit.undo();
	assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...before, revision: 0, updatedAt: '' });
	controller.actions.timeline.selectTrack('foreign-labels'); controller.actions.labels.add();
	const explicit: unknown = controller.project; assert.ok(validateSoundscaperProject(explicit));
	const foreign = explicit.tracks.find(track => track.id === 'foreign-labels');
	assert.ok(foreign && Array.isArray(foreign.labels)); assert.equal(foreign.labels.length, 1, 'an explicitly focused label track remains authoritative');
});

test('NP034: the first label in a secondary Framescaper sequence creates its track in that sequence', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const project = createFramescaperProject(PROFILE, { id: 'secondary-label', tracks: [
		{ id: 'foreign-labels', name: 'Foreign labels', type: 'label', labels: [] }, createAudioTrack({ id: 'voice', name: 'Voice' }),
	], sequences: [{ id: 'main', trackIds: ['foreign-labels'] }, { id: 'other', trackIds: ['voice'] }], primarySequenceId: 'main' });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, environment.store);
	assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Secondary.fscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.selectTrack('voice'); controller.actions.labels.add();
	const result = controller.project; assert.ok(result);
	const sequences: unknown = result.sequences, tracks: unknown = result.tracks;
	assert.ok(Array.isArray(sequences) && Array.isArray(tracks));
	const labeled = tracks.filter((track: unknown): track is Readonly<{ id: string; labels: readonly unknown[] }> =>
		Boolean(track && typeof track === 'object' && 'id' in track && typeof track.id === 'string'
			&& 'labels' in track && Array.isArray(track.labels) && track.labels.length === 1));
	assert.equal(labeled.length, 1);
	const other: unknown = sequences.find((sequence: unknown) => sequence && typeof sequence === 'object' && 'id' in sequence && sequence.id === 'other');
	assert.ok(other && typeof other === 'object' && 'trackIds' in other && Array.isArray(other.trackIds));
	assert.ok(other.trackIds.includes(labeled[0]!.id));
});
