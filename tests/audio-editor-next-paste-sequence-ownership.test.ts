/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { hasLockedClipboardPasteTarget } from '../src/common/editor/clipboard-paste-targets.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
test('NP033: multi-track Copy/Paste keeps its destination sequence at a visible sequence boundary', async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'tone', name: 'Tone', frameCount: 4800, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const tracks = ['a', 'b', 'foreign'].map(id => createAudioTrack({ id, name: id, clipIds: [`clip-${id}`], locked: id === 'foreign' }));
	const original = createSoundscaperProject({ id: 'sequence-source', sources: [source], tracks,
		clips: tracks.map(track => createAudioClip({ id: `clip-${track.id}`, sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })),
		sequences: [{ id: 'main', trackIds: ['a', 'b'] }, { id: 'other', trackIds: ['foreign'] }], primarySequenceId: 'main' });
	const archive = await exportScapeProject(original, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Sequences.sscape'), () => 'copy');
	controller.actions.timeline.setExactSelection(0, 4800, { trackIds: ['a', 'b'] }); controller.actions.edit.copy();
	assert.equal(controller.getSnapshot().readOnly, false, 'the shipping archive opens as an editable document');
	controller.actions.timeline.selectTrack('b'); controller.actions.timeline.setExactSelection(0, 0, { trackIds: ['b'] });
	assert.equal(controller.getSnapshot().history.pasteTargetLocked, false, 'an unrelated locked sequence must not disable Paste');
	const before = controller.project;
	await controller.actions.edit.paste();
	const pasted: unknown = controller.project; assert.ok(validateSoundscaperProject(pasted));
	assert.equal(pasted.clips.length, 5, JSON.stringify(controller.getSnapshot().status));
	const expectedSequence = 'main';
	const expectedTracks = new Set(pasted.sequences.find(sequence => sequence.id === expectedSequence)?.trackIds);
	const added = pasted.clips.filter(clip => !before?.clips.some(previous => previous.id === clip.id));
	assert.equal(added.length, 2);
	for (const clip of added) assert.ok(pasted.tracks.some(track => expectedTracks.has(track.id) && Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)));
	controller.actions.edit.undo(); assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...before, revision: 0, updatedAt: '' });
	controller.actions.edit.redo(); assert.deepEqual({ ...controller.project, revision: 0, updatedAt: '' }, { ...pasted, revision: 0, updatedAt: '' });
});

test('NP033: target lock planning excludes a locked track in the next sequence', () => {
	const project = { primarySequenceId: 'main', tracks: [{ id: 'a', type: 'audio', clipIds: [] }, { id: 'b', type: 'audio', clipIds: [] }, { id: 'foreign', type: 'audio', clipIds: [], locked: true }],
		sequences: [{ id: 'main', trackIds: ['a', 'b'] }, { id: 'other', trackIds: ['foreign'] }] };
	assert.equal(hasLockedClipboardPasteTarget(project, { tracks: ['a', 'b'].map(sourceTrackId => ({ sourceTrackId, sourceSequenceId: 'main', sourceTrackType: 'audio', clips: [] })) }, 'b'), false);
});
