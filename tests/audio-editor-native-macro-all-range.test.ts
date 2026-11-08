/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroCommandService } from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import { selectedTrackContentRange } from '../src/common/editor/controller/track-audio/internal/selected-track-content-range.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17, type AudioEditorProjectV17Options } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createTakeFitProject } from './helpers/take-fit-project.ts';

test('native SelectAll requests the native content range through its existing public timeline port', () => {
	let options: unknown;
	const project = audioProject();
	const service = createMacroCommandService({ getProject: () => ({ ...project, tracks: project.tracks.map(track => ({ ...track })) }),
		projectSampleRate: () => 8000, timelineDurationFrames: () => 6000, setExactSelection: () => undefined,
		getActions: () => ({ timeline: { selectAll: (value: unknown) => { options = value; } } }),
	});
	service.runMacroCommand(createMacroCommandStep('SelectAll'));
	assert.deepEqual(options, { nativeRegion: true });
});

test('a delayed-only track has a positive content origin independent of viewport extent', () => {
	assert.deepEqual(nativeRange(audioProject()), { startFrame: 2000, endFrame: 6000 });
});

test('a genuinely empty native track contributes origin zero beside delayed content', () => {
	assert.deepEqual(nativeRange(audioProject({ tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 8000), createAudioTrack({ id: 'empty' }, 8000)] })),
		{ startFrame: 0, endFrame: 6000 });
});

test('native labels contribute both the earliest start and latest end', () => {
	assert.deepEqual(nativeRange(audioProject({ tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 8000),
		createLabelTrack({ id: 'labels', labels: [{ id: 'label', startFrame: 1000, endFrame: 10000, text: 'Programme' }] })] })),
		{ startFrame: 1000, endFrame: 10000 });
});

test('an empty label track also retains the native zero origin', () => {
	assert.equal(nativeRange(audioProject({ tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 8000), createLabelTrack({ id: 'labels' })] }))?.startFrame, 0);
});

test('active timeline annotations contribute bounds without another sequence extending them', () => {
	const base = audioProject();
	const project = createAudioEditorProjectV17({ ...base,
		sequences: [...base.sequences, { id: 'other', trackNodes: [] }],
		timelineAnnotations: [
			{ color: 'blue', batchId: null, opaqueExtensions: {}, id: 'marker', sequenceId: base.primarySequenceId, kind: 'marker', anchor: 'sample', positionFrame: 1000, name: 'Earlier' },
			{ color: 'blue', batchId: null, opaqueExtensions: {}, id: 'region', sequenceId: base.primarySequenceId, kind: 'region', anchor: 'sample', startFrame: 5000, endFrame: 10000, name: 'Later' },
			{ color: 'blue', batchId: null, opaqueExtensions: {}, id: 'other-region', sequenceId: 'other', kind: 'region', anchor: 'sample', startFrame: 0, endFrame: 20000, name: 'Other' },
		],
	});
	assert.deepEqual(nativeRange(project), { startFrame: 1000, endFrame: 10000 });
});

test('musical clip bounds use the owning runtime tempo projection', () => {
	const project = audioProject({ tempo: { bpm: 120 }, clips: [createAudioClip({ id: 'clip', sourceId: 'source', anchor: 'musical',
		musicalStartBeat: 4, musicalExtent: 'beat', musicalDurationBeats: 2, sourceDurationFrames: 4000 })] });
	assert.deepEqual(nativeRange(project), { startFrame: 16000, endFrame: 24000 });
});

test('take-only lanes keep their authored origin instead of looking like empty tracks', () => {
	const original = createTakeFitProject();
	const project = createSoundscaperProject({ ...original, clips: [], tracks: original.tracks.map(track => ({ ...track, clipIds: [] })) });
	assert.deepEqual(nativeRange(project), { startFrame: 480000, endFrame: 576000 });
});

test('ordinary content and owned takes share the full native range', () => {
	assert.deepEqual(nativeRange(createTakeFitProject()), { startFrame: 0, endFrame: 576000 });
});

test('all-empty tracks retain an exact zero range rather than the viewport tail', () => {
	assert.deepEqual(nativeRange(audioProject({ sources: [], clips: [], tracks: [createAudioTrack({ id: 'empty' }, 8000)] })), { startFrame: 0, endFrame: 0 });
});

function audioProject(options: AudioEditorProjectV17Options = {}) {
	return createAudioEditorProjectV17({ sampleRate: 8000,
		sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 12000, sampleRate: 8000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 2000, durationFrames: 4000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 8000)], ...options });
}

function nativeRange(project: ReturnType<typeof createAudioEditorProjectV17> | ReturnType<typeof createSoundscaperProject>) {
	assert.ok(project.schemaFamily === 'soundscaper' ? validateSoundscaperProject(project) : validateAudioEditorProjectV17(project));
	const view = { ...project, tracks: project.tracks.map(track => ({ ...track })), clips: project.clips.map(clip => ({ ...clip })) };
	return selectedTrackContentRange(view, view.tracks.map(track => track.id), () => 0, { nativeAll: true });
}
