/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createClipSourcePreviewProject, type ClipSourcePreviewProject } from '../src/common/editor/controller/clip-video/internal/clip-source-preview-project.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { autoTuneControlNotes } from '../src/common/editor/first-party-effects/auto-tune/project-control.ts';

test('source audition retains a moved clip detector input without leaking its programme audio', async context => {
	const native = createNodeWebAudioEngineFactory(context);
	const music = new AudioBuffer({ numberOfChannels: 1, length: 48000, sampleRate: 48000 });
	const guide = new AudioBuffer({ numberOfChannels: 1, length: 48000, sampleRate: 48000 });
	music.getChannelData(0).fill(.25); guide.getChannelData(0).fill(.5, 12000, 24000);
	const project = createSoundscaperProject({ sampleRate: 48000,
		sources: ['music', 'guide'].map(id => ({ id, frameCount: 48000, sampleRate: 48000, channelCount: 1 })),
		clips: [{ id: 'music', sourceId: 'music', timelineStartFrame: 12000, sourceStartFrame: 4000, durationFrames: 24000,
			effects: [createEffect('audacity-auto-duck', { context: { controlTrackId: 'guide' }, params: { outerFadeDown: .1, outerFadeUp: .1, maximumPause: .1 } })] },
		{ id: 'guide', sourceId: 'guide', durationFrames: 48000 }],
		tracks: [{ id: 'music', type: 'audio', clipIds: ['music'] }, { id: 'guide', type: 'audio', clipIds: ['guide'], gain: 0 }],
	});
	const runtime = projectForRuntimeConsumers(project), buffers = new Map([
		['music', music as unknown as globalThis.AudioBuffer], ['guide', guide as unknown as globalThis.AudioBuffer],
	]);
	const engine = native.createEngine(); engine.loadProject(runtime, buffers);
	const options = { startFrame: 12000, endFrame: 36000, includeTail: false, includeMaster: false, includeTrackPan: false, preRollFrames: 0 } as const;
	const expected = audioBufferChannels(await engine.renderMix(options))[0]!; await engine.dispose();
	const preview = createClipSourcePreviewProject(runtime as unknown as ClipSourcePreviewProject, 'music');
	const audition = native.createEngine();
	try {
		audition.loadProject(preview, buffers);
		const measured = audioBufferChannels(await audition.renderMix(options))[0]!;
		const error = measured.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - expected[frame]!)), 0);
		assert.ok(expected.some(sample => sample > .2) && expected.some(sample => sample > 0 && sample < .1));
		assert.ok(error < 1e-6, `source audition must preserve the authored ducking, error ${String(error)}`);
	} finally { await audition.dispose(); }
});

test('source audition retains the external MIDI guide metadata and authored note clock', () => {
	const guide = createMidiClip({ id: 'guide', sourceId: 'guide', durationFrames: 48000, sourceDurationFrames: 48000,
		notes: [{ id: 'key', pitch: 69, channel: 0, velocity: 100, startFrame: 13000, durationFrames: 7000 }] });
	const project = createSoundscaperProject({ sampleRate: 48000,
		sources: ['music', 'guide'].map(id => ({ id, frameCount: 48000, sampleRate: 48000, channelCount: 1 })),
		clips: [{ id: 'music', sourceId: 'music', timelineStartFrame: 12000, sourceStartFrame: 4000, durationFrames: 24000,
			effects: [createEffect('auto-tune', { params: { controlTrackId: 'guide' } })] }, guide],
		tracks: [{ id: 'music', type: 'audio', clipIds: ['music'] }, createMidiTrack({ id: 'guide', clipIds: ['guide'] })],
	});
	const preview = createClipSourcePreviewProject(projectForRuntimeConsumers(project) as unknown as ClipSourcePreviewProject, 'music');
	assert.equal(preview.clipSourcePreviewOriginFrame, 8000);
	assert.deepEqual(autoTuneControlNotes(preview, 'guide', 12000, 24000, 48000), [{ startFrame: 1000, endFrame: 8000, pitch: 69 }]);
});
