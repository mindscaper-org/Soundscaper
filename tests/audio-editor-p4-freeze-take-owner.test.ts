/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { computeAudioTrackFreezeDigestsV1, type AudioTrackFreezeV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { createSoundscaperProject, loadSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand, redoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

const LIVE_DIGEST = 'ab'.repeat(32), DERIVED_DIGEST = 'cd'.repeat(32);
for (const owner of ['take', 'bin', 'timeline', 'none'] as const) test(`Freeze Commit respects ${owner} ownership of its editable source`, () => {
	const { project, freeze, digests, sourceContentIdentities, derivedSource } = fixture(owner);
	const installed = executeSoundscaperProjectCommand(createSoundscaperProjectHistory(project), {
		type: 'audio-freeze/install', trackId: 'voice', expectedFreeze: null, replacementFreeze: freeze, derivedSource, sourceContentIdentities,
	});
	const committed = executeSoundscaperProjectCommand(installed, {
		type: 'audio-freeze/commit', trackId: 'voice', expectedFreeze: freeze, operationDigests: digests, derivedSourceContentSha256: DERIVED_DIGEST,
		derivedClip: createAudioClip({ id: 'committed', sourceId: 'rendered', durationFrames: 4800, sourceDurationFrames: 4800 }),
	});
	const after = committed.present;
	assert.equal(after.sources.some(({ id }) => id === 'recording'), owner !== 'none');
	assert.deepEqual(after.takeGroups, project.takeGroups);
	assert.deepEqual(after.projectBin, project.projectBin);
	assert.equal(after.clips.some(({ id }) => id === 'ordinary'), false);
	assert.equal(after.tracks.find(({ id }) => id === 'voice')?.audioFreeze, undefined);
	assert.deepEqual(loadSoundscaperProject(structuredClone(after)).project, after);
	const undone = undoSoundscaperProjectCommand(committed);
	assert.deepEqual(authoredDocument(undone.present), authoredDocument(installed.present));
	assert.deepEqual(authoredDocument(redoSoundscaperProjectCommand(undone).present), authoredDocument(after));
	assert.deepEqual(installed.present.takeGroups, project.takeGroups, 'the frozen input remains immutable');
});

function authoredDocument(project: Readonly<Record<string, unknown>>) {
	const { revision: _revision, updatedAt: _updatedAt, ...authored } = project;
	return authored;
}

function fixture(owner: 'take' | 'bin' | 'timeline' | 'none') {
	const source = createAudioSource({ id: 'recording', storageKey: 'recording', name: 'Recorded take.wav', sampleRate: 48000,
		frameCount: 4800, channelCount: 1, contentSha256: LIVE_DIGEST });
	const clip = createAudioClip({ id: 'ordinary', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 });
	const peer = createAudioClip({ ...clip, id: 'peer' });
	const project = createSoundscaperProject({ id: 'freeze-take-owner', title: 'Freeze take owner', sources: [source],
		clips: owner === 'timeline' ? [clip, peer] : [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] }),
			createAudioTrack({ id: 'takes', name: 'Retained takes', clipIds: owner === 'timeline' ? [peer.id] : [] })],
		projectBin: owner === 'bin' ? { clips: [{ ...peer, binItemId: 'peer-item' }] } : { clips: [] },
		takeGroups: owner === 'take' ? [{ id: 'group', sequenceId: 'main-sequence', trackId: 'takes', startSample: 0, endSample: 4800,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 4800, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 4800 }] }] : [] });
	const track = project.tracks.find(({ id }) => id === 'voice'); assert.ok(track);
	const sourceContentIdentities = [{ sourceId: source.id, contentSha256: LIVE_DIGEST }];
	const digests = computeAudioTrackFreezeDigestsV1({ sampleRate: 48000, renderStartFrame: 0, renderFrameCount: 4800, track,
		clips: [clip], sourceContentIdentities, automationLanes: [], tempoMap: project.tempoMap });
	const freeze: AudioTrackFreezeV1 = { schemaVersion: 1, derivedSourceId: 'rendered', ...digests, renderStartFrame: 0,
		renderFrameCount: 4800, capturePosition: 'post-insert-pre-strip' };
	return { project, freeze, digests, sourceContentIdentities, derivedSource: createAudioSource({ id: 'rendered', storageKey: 'rendered',
		name: 'Frozen recording', frameCount: 4800, channelCount: 1, sampleRate: 48000, contentSha256: DERIVED_DIGEST }) };
}
