/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { readTrackPlaylists } from '../src/common/editor/track-playlists.ts';
import { audioTrackChannelCount } from '../src/common/editor/project-audio-factory.js';
import { createTrackTransformService } from '../src/common/editor/controller/track-audio/internal/track-transform-service.ts';
import type { TrackTransformServiceDependencies } from '../src/common/editor/controller/track-audio/internal/track-transform-service.ts';
import { findControllerSource, type ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function fixture(playlists = false, panAutomation = false, channelCount = 2) {
	let project = createSoundscaperProject({ sources: [{ id: 'source', storageKey: 'source', frameCount: 100, sampleRate: 48000, channelCount }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 100 },
			...(channelCount === 1 ? [{ id: 'partner-clip', sourceId: 'source', durationFrames: 100 }] : [])],
		automationLanes: panAutomation ? ['detector', 'programme'].map(id => ({ id: `${id}-pan`, timebase: 'absolute-samples',
			address: { kind: 'strip', strip: { kind: 'track', id }, parameterId: 'pan' },
			points: [{ id: 'point', position: 0, value: .5 }], segments: [] })) : [],
		tracks: [{ id: 'detector', type: 'audio', clipIds: ['clip'] }, { id: 'programme', type: 'audio', clipIds: channelCount === 1 ? ['partner-clip'] : [],
			effects: [createEffect('audacity-auto-duck', { id: 'duck', context: { controlTrackId: 'detector' } })] }],
	});
	if (playlists) project = applySoundscaperProjectCommand(project, { type: 'track/playlist-create', trackId: 'detector',
		id: 'copy', name: 'Copy', originalId: 'original', originalName: 'Original', mode: 'duplicate' });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const view = () => runtime.projectForCommandConsumers(project) as ControllerProject;
	let sequence = 0, preflights = 0;
	const dependencies: TrackTransformServiceDependencies = {
		lifetime: { assertActive() {}, startTask: name => ({ name, scope: null, generation: 0,
			signal: new AbortController().signal, assertCurrent() {}, finish() {}, abort() {} }) },
		copy: { v2Required: 'Current project required', audioTrackRequired: 'Audio required', stereoTrackRequired: 'Stereo required',
			monoTrackRequired: 'Mono required', compatibleMonoTrackRequired: 'Compatible mono tracks required',
			resamplingTrack: 'Resampling', audacityProcessing: 'Processing', rewritingChannels: 'Rewriting', done: 'Done',
			channelsSwapped: 'Swapped', leftChannel: 'Left', rightChannel: 'Right', stereo: 'Stereo' },
		derivedSources: {
			uniqueClipSources: clips => [...new Set(clips.map(clip => clip.sourceId))].map(id => findControllerSource(view(), id)!),
			sourceChannelsForEdit: async source => Array.from({ length: source.channelCount }, (_, channel) => new Float32Array(source.frameCount).fill((channel + 1) / 4)),
			persistDerivedSource: async (source, channels, name) => { const id = `derived-${++sequence}`; return {
				source: { ...source, id, storageKey: id, name, channelCount: channels.length }, channels, buffer: null }; },
			persistRenderedMixSource: async () => { throw new Error('Unexpected mix render'); }, rollbackDerivedSources: async () => {},
		},
		getProject: view, getSelectedTrackId: () => 'detector', editingBlocked: () => false,
		captureProject: () => ({ projectId: project.id, generation: 0 }), assertProject() {}, createId: prefix => `${prefix}-${++sequence}`,
		previewCommand: (_before, command) => runtime.projectForCommandConsumers(applySoundscaperProjectCommand(project, command)),
		commit: command => { project = applySoundscaperProjectCommand(project, command); return project; },
		projectSampleRate: () => 48000, normalizeProjectSampleRate: Number, audioTrackChannelCount,
		preflightStorage: async () => { preflights++; }, setProcessing() {}, setStatus() {}, publish() {},
		resampleChannels: channels => channels, renderDryTrackRange: async () => { throw new Error('Unexpected dry render'); },
	};
	return { service: createTrackTransformService(dependencies), getProject: () => project, getPreflights: () => preflights };
}

for (const centered of [false, true]) test(`stereo ${centered ? 'centered' : 'L/R'} split preserves the surviving detector's external Auto Duck assignment`, async () => {
	const f = fixture();
	const before = f.getProject().tracks.find(track => track.id === 'programme')!.effects;
	await f.service.splitStereoTrack('detector', !centered);
	assert.deepEqual(f.getProject().tracks.find(track => track.id === 'programme')!.effects, before);
	assert.equal(f.getProject().tracks.length, 3);
	const clipIds = f.getProject().tracks.find(track => track.id === 'detector')!.clipIds;
	assert.ok(Array.isArray(clipIds));
	assert.equal(clipIds.length, 1);
});

test('channel splitting refuses saved alternatives before allocating media and retains every playlist', async () => {
	const f = fixture(true);
	const before = f.getProject();
	await assert.rejects(f.service.splitStereoTrack('detector'), /playlist/iu);
	assert.equal(f.getProject(), before);
	assert.equal(f.getPreflights(), 0);
	assert.equal(readTrackPlaylists(f.getProject())[0]!.playlists.length, 2);
});


test('stereo split clears its former pan automation without removing other tracks’ lanes', async () => {
	const f = fixture(false, true);
	await f.service.splitStereoTrack('detector');
	assert.deepEqual(f.getProject().automationLanes.map(lane => lane.id), ['programme-pan']);
	assert.equal(f.getProject().tracks.find(track => track.id === 'detector')!.pan, -1);
});


test('joining mono channels refuses saved alternatives before rendering or allocating media', async () => {
	const f = fixture(true, false, 1);
	const before = f.getProject();
	await assert.rejects(f.service.makeStereoTrack('detector', 'programme'), /playlist/iu);
	assert.equal(f.getProject(), before);
	assert.equal(f.getPreflights(), 0);
});
