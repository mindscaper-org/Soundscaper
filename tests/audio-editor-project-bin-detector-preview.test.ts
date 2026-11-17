/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorController, createTwoTrackFixture, ENGLISH_COPY } from './helpers/audio-editor-multitrack-selection-harness.js';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createProjectBinAudioPreviewProject } from '../src/common/editor/controller/import/internal/project-bin/project-bin-preview-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { autoTuneControlNotes } from '../src/common/editor/first-party-effects/auto-tune/project-control.ts';
import type { ProjectBinProject } from '../src/common/editor/controller/import/project-bin-types.ts';
import type { WebAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';

// Moving to the Bin retains the authored clip rack; its existing Play action
// must audition that rack using the same detector clock as timeline playback.
test('Project Bin Play preserves a moved clip external detector without mixing its guide', async context => {
	const native = createNodeWebAudioEngineFactory(context), engines: WebAudioEditorEngine[] = [];
	const factory: typeof native.createEngine = options => { const engine = native.createEngine(options); engines.push(engine); return engine; };
	const music = new Float32Array(48000).fill(.25), guide = new Float32Array(48000); guide.fill(.5, 12000, 24000);
	const { store } = await createTwoTrackFixture('bin-duck-preview', new Map([['main', music], ['guide', guide]]), 48000);
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: factory(), engineFactory: factory, ffmpeg: { dispose() {} } as unknown as NonNullable<Parameters<typeof createAudioEditorController>[1]>['ffmpeg'] });
	try {
		await controller.ready;
		controller.actions.track.update('guide', { gain: 0 });
		controller.actions.clip.move('main-clip', 'main', 12000);
		controller.actions.effects.add({ scope: 'clip', trackId: 'main-clip', type: 'audacity-auto-duck',
			context: { controlTrackId: 'guide' }, params: { outerFadeDown: .1, outerFadeUp: .1, maximumPause: .1 } });
		const options = { startFrame: 12000, endFrame: 60000, includeTail: false, includeMaster: false, includeTrackPan: false, preRollFrames: 0 } as const;
		const expected = audioBufferChannels(await engines[0]!.renderMix(options))[0]!;
		assert.ok(expected.some(sample => sample > .2) && expected.some(sample => sample > 0 && sample < .1), 'timeline music must actually duck');
		controller.actions.projectBin.moveFromTimeline('main-clip');
		await controller.actions.projectBin.playPause('main-clip');
		assert.equal(controller.getSnapshot().projectBinPreview?.state, 'playing');
		const measured = audioBufferChannels(await engines[1]!.renderMix(options))[0]!;
		const error = measured.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - expected[frame]!)), 0);
		assert.ok(error < 1e-6, `the moved clip must retain authored ducking without guide audio; error ${error}`);
	} finally { await controller.dispose(); }
});


test('Bin audition retains external MIDI guide notes at the moved clip authored clock', () => {
	const project = createSoundscaperProject({ sampleRate: 48000,
		sources: ['music', 'guide'].map(id => ({ id, frameCount: 48000, sampleRate: 48000, channelCount: 1 })),
		clips: [{ id: 'music', sourceId: 'music', timelineStartFrame: 12000, durationFrames: 24000,
			effects: [createEffect('auto-tune', { params: { controlTrackId: 'guide' } })] },
		createMidiClip({ id: 'guide', sourceId: 'guide', durationFrames: 48000, sourceDurationFrames: 48000,
			notes: [{ id: 'key', pitch: 69, channel: 0, velocity: 100, startFrame: 13000, durationFrames: 7000 }] })],
		tracks: [{ id: 'music', type: 'audio', clipIds: ['music'] }, createMidiTrack({ id: 'guide', clipIds: ['guide'] })],
	});
	const runtime = projectForRuntimeConsumers(project);
	const moved = { ...runtime, tracks: runtime.tracks.map(track => track.id === 'music' ? { ...track, clipIds: [] } : track),
		clips: runtime.clips.filter(clip => clip.id !== 'music'), projectBin: { clips: runtime.clips.filter(clip => clip.id === 'music') } } as unknown as ProjectBinProject;
	const clip = moved.projectBin!.clips[0]!, source = moved.sources.find(candidate => candidate.id === clip.sourceId)!;
	const preview = createProjectBinAudioPreviewProject(moved, clip, source, 'bin-audition');
	assert.equal(preview.startFrame, 12000);
	assert.deepEqual(autoTuneControlNotes(preview.project, 'guide', 12000, 24000, 48000), [{ startFrame: 1000, endFrame: 8000, pitch: 69 }]);
	assert.deepEqual(preview.clipIds, ['music', 'guide']);
});
