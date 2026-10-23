/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const owner of ['main', 'cut'] as const) for (const operation of ['move', 'drag-copy', 'edit-duplicate'] as const) {
	test(`P3-003: ${operation} retains its ${owner} sequence in a new lane`, async context => {
		const prior = globalThis.AudioContext;
		globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
		context.after(() => { globalThis.AudioContext = prior; });
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		} });
		const controller = createFramescaperAudioEditorController(environment);
		context.after(async () => { await controller.dispose(); await environment.close(); });
		await controller.ready;
		const source = createAudioSource({ id: 'tone', name: 'Tone', sampleRate: 48_000, channelCount: 1, frameCount: 4_800 });
		const writer = await environment.store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4_800).fill(.25)]); await writer.commit();
		const clip = createAudioClip({ id: 'clip', title: 'Recording', sourceId: source.id,
			durationFrames: 4_800, sourceDurationFrames: 4_800 });
		const project = createFramescaperProject(PROFILE, { id: 'move-sequences', sources: [source],
			tracks: ['main', 'cut'].map(id => createAudioTrack({ id: `${id}-audio`, name: id,
				clipIds: id === owner ? ['clip'] : [],
			})), clips: [clip],
			sequences: ['main', 'cut'].map(id => ({ id, trackIds: [`${id}-audio`] })), primarySequenceId: 'main',
		});
		const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, environment.store);
		assert.ok(archive.blob instanceof Blob);
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Move.fscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		controller.actions.timeline.selectClip('clip');
		const before = controller.project;
		let trackId: string | null;
		if (operation === 'edit-duplicate') {
			controller.actions.edit.duplicate();
			trackId = controller.getSnapshot().selectedTrackId;
		} else trackId = controller.actions.clip.moveToNewTrack('clip', 0, { exactFrame: true, duplicate: operation === 'drag-copy' });
		assert.ok(trackId);
		assert.notEqual(trackId, `${owner}-audio`);
		const after: unknown = controller.project; assert.ok(validateFramescaperProject(PROFILE, after));
		const sequence = records(after.sequences).find(sequence => sequence.id === owner);
		assert.ok(sequence && Array.isArray(sequence.trackIds));
		assert.ok(sequence.trackIds.includes(trackId), 'the new lane belongs to the original programme');
		const other = owner === 'main' ? 'cut' : 'main';
		assert.deepEqual(records(after.sequences).find(sequence => sequence.id === other)?.trackIds, [`${other}-audio`]);
		assert.equal(records(after.clips).length, operation === 'move' ? 1 : 2);
		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.tracks, before?.tracks);
		assert.deepEqual(controller.project?.clips, before?.clips);
		assert.deepEqual(controller.project?.sequences, before?.sequences);
		controller.actions.edit.redo();
		assert.deepEqual(controller.project?.tracks, after.tracks);
		assert.deepEqual(controller.project?.clips, after.clips);
		assert.deepEqual(controller.project?.sequences, after.sequences);
	});
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value));
	return (value as unknown[]).map(value => {
		assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
		return value as Readonly<Record<string, unknown>>;
	});
}
