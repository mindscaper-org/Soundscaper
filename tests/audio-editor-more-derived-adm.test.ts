/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAdmProjectMetadata, validateAdmAuthoredRouting, type RoutingProject } from '../src/common/editor/adm-project-metadata.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createDefaultAdmMetadata, setAdmEditorAssignment } from '../src/common/editor/ui/adm-metadata-editor-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

test('MP40: Duplicate Track preserves authored ADM bed and positioned-object delivery', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'more-derived-adm' });
	const source = createAudioSource({ id: 'source', frameCount: 8, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.id, source); await writer.write([new Float32Array(8).fill(0.25)]); await writer.commit();
	let project = createSoundscaperProject({ id: 'derived-adm', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, durationFrames: 8, sourceDurationFrames: 8 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const adm = setAdmEditorAssignment(createDefaultAdmMetadata(project, 'stereo'), {
		stripKind: 'track', stripId: 'voice', sourceChannel: 0, bedChannel: 'R', gain: 0.5,
	});
	project = createSoundscaperProject({ ...project, metadata: { ...project.metadata, adm } });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.track.duplicate('voice');
	const duplicated = controller.project;
	assert.ok(duplicated);
	const newTrack = duplicated.tracks.find(({ id }) => id !== 'voice'); assert.ok(newTrack);
	assert.ok(duplicated.metadata.adm);
	const duplicatedAdm = normalizeAdmProjectMetadata(duplicated.metadata.adm);
	assert.equal(duplicatedAdm?.mode, 'authored');
	if (duplicatedAdm?.mode !== 'authored') assert.fail('Expected authored ADM.');
	assert.deepEqual(duplicatedAdm.bed.assignments.find(({ stripId }) => stripId === newTrack.id), {
		stripKind: 'track', stripId: newTrack.id, sourceChannel: 0, bedChannel: 'R', gain: 0.5,
	});
	assert.equal(validateAdmAuthoredRouting(duplicatedAdm, duplicated as unknown as RoutingProject)
		.some(({ code }) => code === 'missing-terminal-strip'), false);
	controller.actions.edit.undo();
	controller.actions.edit.commit({ type: 'metadata/update', changes: { adm: { ...adm, objects: [{ id: 'voice-object', name: 'Voice object',
		stripKind: 'track', stripId: 'voice', sourceChannel: 0, gain: 0.75, position: { azimuth: 20, elevation: 10, distance: 1 } }] } } });
	controller.actions.track.duplicate('voice');
	const objectProject = controller.project; assert.ok(objectProject);
	assert.ok(objectProject.metadata.adm);
	const objects = normalizeAdmProjectMetadata(objectProject.metadata.adm);
	assert.equal(objects?.mode, 'authored'); if (objects?.mode !== 'authored') assert.fail('Expected authored ADM.');
	assert.equal(objects.objects?.length, 2);
	assert.equal(objectProject.masterChannels, 4);
	assert.notEqual(objects.objects?.[0]?.id, objects.objects?.[1]?.id);
	assert.notEqual(objects.objects?.[0]?.stripId, objects.objects?.[1]?.stripId);
	assert.deepEqual(objects.objects?.[0]?.position, objects.objects?.[1]?.position);
});
