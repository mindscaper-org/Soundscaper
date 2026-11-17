/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { createExportClipProject } from '../src/common/editor/export-clips.ts';
import { stemProject } from '../src/common/editor/controller/export/temporary-export.ts';
import { AudioBuffer } from 'node-web-audio-api';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';

for (const type of ['audacity-auto-duck', 'auto-tune']) test(`clip export keeps ${type} controls and silences their programme outputs`, () => {
	const effect = createEffect(type, { id: 'control', ...(type === 'auto-tune' ? { params: { controlTrackId: 'voice' } }
		: { context: { controlTrackId: 'voice' } }) });
	const project = createSoundscaperProject({ id: 'clip-controls', sampleRate: 48_000,
		sources: [{ id: 'source', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 }],
		tracks: ['music', 'voice', 'nested', 'unrelated'].map(id => ({ id, type: 'audio', clipIds: [id + '-clip'] })),
		clips: ['music', 'voice', 'nested', 'unrelated'].map(id => ({ id: id + '-clip', kind: 'audio', sourceId: 'source', durationFrames: 48_000,
			effects: id === 'music' ? [effect] : id === 'voice' ? [createEffect('audacity-auto-duck', { id: 'nested-control', context: { controlTrackId: 'nested' } })] : [] })),
	});
	const before = structuredClone(project);
	const plan = createExportPlan(project, { mode: 'clips', format: 'wav' });
	const output = plan.outputs.find(item => item.clipId === 'music-clip')!;
	const snapshot = createExportClipProject(stemProject(project, 'music'), output);
	assert.deepEqual(snapshot.clips.map(clip => clip.id), ['music-clip', 'voice-clip', 'nested-clip']);
	for (const id of ['voice', 'nested']) {
		assert.equal(snapshot.tracks.find(track => track.id === id)!.mute, false);
		const outputs = snapshot.mixer.edges.filter(edge => edge.source.kind === 'track' && edge.source.id === id);
		assert.ok(outputs.length);
		assert.ok(outputs.every(edge => edge.level === 0), 'control feeds do not join the delivered programme');
	}
	assert.deepEqual(project, before);
});

test('clip export does not retain dependencies belonging only to a neighboring clip', () => {
	const project = createSoundscaperProject({ id: 'neighbor-controls', sampleRate: 48_000,
		sources: [{ id: 's', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 }],
		tracks: [{ id: 'music', type: 'audio', clipIds: ['chosen', 'neighbor'] }, { id: 'voice', type: 'audio', clipIds: ['voice'] }],
		clips: ['chosen', 'neighbor', 'voice'].map(id => ({ id, sourceId: 's', kind: 'audio', durationFrames: 48_000,
			effects: id === 'neighbor' ? [createEffect('audacity-auto-duck', { id: 'duck', context: { controlTrackId: 'voice' } })] : [] })),
	});
	const snapshot = createExportClipProject(stemProject(project, 'music'), { trackId: 'music', clipId: 'chosen' });
	assert.deepEqual(snapshot.clips.map(clip => clip.id), ['chosen']);
});

test('clip export renders the authored ducking without adding its loud detector to the PCM', async context => {
	const native = createNodeWebAudioEngineFactory(context);
	const music = new AudioBuffer({ numberOfChannels: 1, length: 48_000, sampleRate: 48_000 });
	const voice = new AudioBuffer({ numberOfChannels: 1, length: 48_000, sampleRate: 48_000 });
	music.getChannelData(0).fill(.25); voice.getChannelData(0).fill(.5, 24_000, 36_000);
	const project = createSoundscaperProject({ sampleRate: 48_000, masterChannels: 1,
		sources: ['music', 'voice'].map(id => ({ id, frameCount: 48_000, sampleRate: 48_000, channelCount: 1 })),
		clips: [{ id: 'music', sourceId: 'music', timelineStartFrame: 12_000, durationFrames: 36_000,
			effects: [createEffect('audacity-auto-duck', { context: { controlTrackId: 'voice' },
				params: { outerFadeDown: .1, outerFadeUp: .1, maximumPause: .1 } })] },
		{ id: 'voice', sourceId: 'voice', durationFrames: 48_000 }],
		tracks: [{ id: 'music', type: 'audio', clipIds: ['music'] }, { id: 'voice', type: 'audio', clipIds: ['voice'], gain: 0 }],
	});
	const buffers = new Map([['music', music as unknown as globalThis.AudioBuffer], ['voice', voice as unknown as globalThis.AudioBuffer]]);
	const render = async (value: typeof project) => {
		const engine = native.createEngine();
		try {
			engine.loadProject(projectForRuntimeConsumers(value), buffers);
			return audioBufferChannels(await engine.renderMix({ startFrame: 12_000, endFrame: 48_000,
				includeMaster: false, includeTrackPan: false, includeTail: false, preRollFrames: 0 }))[0]!.slice();
		} finally { await engine.dispose(); }
	};
	const reference = await render(project);
	assert.ok(reference.some(sample => sample > .2) && reference.some(sample => sample > 0 && sample < .1));
	const audibleDetector = createSoundscaperProject({ ...project, tracks: project.tracks.map(track => track.id === 'voice' ? { ...track, gain: 1 } : track) });
	const exported = createExportClipProject(stemProject(audibleDetector, 'music'), { trackId: 'music', clipId: 'music' });
	const actual = await render(exported);
	assert.equal(actual.length, reference.length);
	const error = actual.reduce((maximum, sample, index) => Math.max(maximum, Math.abs(sample - reference[index]!)), 0);
	assert.ok(error < 1e-6, `authored clip ducking differs by ${error}`);
});
