/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';

for (const production of [false, true]) for (const transitive of production ? [false, true] : [false]) {
	test(`${production ? 'production' : 'legacy'} clip duck stays aligned with ${transitive ? 'a processed detector' : 'its detector'}`, async context => {
		const factory = createNodeWebAudioEngineFactory(context), frames = 144000, outputs: Float32Array[] = [];
		const buffer = new AudioBuffer({ numberOfChannels: 1, length: frames, sampleRate: 48000 }); buffer.getChannelData(0).fill(.25);
		const detector = new AudioBuffer({ numberOfChannels: 1, length: frames, sampleRate: 48000 });
		if (transitive) detector.getChannelData(0).fill(.5); else detector.getChannelData(0).fill(.5, 48000, 72000);
		const control = new AudioBuffer({ numberOfChannels: 1, length: frames, sampleRate: 48000 }); control.getChannelData(0).fill(.5, 48000, 72000);
		const duck = (id: string, controlTrackId: string) => createEffect('audacity-auto-duck', { id,
			params: { outerFadeDown: .1, outerFadeUp: .1, maximumPause: .1, innerFadeDown: 0, innerFadeUp: 0, thresholdDb: -12 }, context: { controlTrackId } });
		for (const scope of ['track', 'clip']) {
			const effect = duck('duck', 'voice');
			const seed = { sampleRate: 48000,
				sources: ['source', 'detector', 'control'].map(id => ({ id, frameCount: frames, channelCount: 1, sampleRate: 48000 })),
				tracks: [{ id: 'music', type: 'audio', clipIds: ['music'], effects: scope === 'track' ? [effect] : [] },
					{ id: 'voice', type: 'audio', clipIds: ['voice'], gain: 0 }, { id: 'control', type: 'audio', clipIds: ['control'], gain: 0 }],
				clips: [{ id: 'music', sourceId: 'source', durationFrames: frames, effects: scope === 'clip' ? [effect] : [] },
					{ id: 'voice', sourceId: 'detector', durationFrames: frames, effects: transitive ? [duck('detector-duck', 'control')] : [] },
					{ id: 'control', sourceId: 'control', durationFrames: frames }],
			};
			let project = production ? createSoundscaperProject(seed) : createAudioEditorProjectV17(seed);
			if (production && scope === 'track') {
				const native = createSoundscaperProject(seed);
				project = createSoundscaperProject({ ...native, mixer: { ...native.mixer, edges: [...native.mixer.edges, {
					id: 'detector-route', kind: 'sidechain', source: { kind: 'track', id: 'voice' },
					destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'music' }, effectId: 'duck' },
					position: 'pre-fader', level: 1, enabled: true, channelMap: [0],
				}] } });
			}
			const engine = factory.createEngine();
			try {
				engine.loadProject(projectForRuntimeConsumers(project), new Map([
					['source', buffer as unknown as globalThis.AudioBuffer], ['detector', detector as unknown as globalThis.AudioBuffer],
					['control', control as unknown as globalThis.AudioBuffer],
				]));
				outputs.push(audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: frames, includeTail: false }))[0]!.slice());
			} finally { await engine.dispose(); }
		}
		assert.ok(outputs[0]!.some(value => value > .17) && outputs[0]!.some(value => value > 0 && value < .05), 'the reference must contain audible gain reduction');
		const error = outputs[0]!.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - outputs[1]![index]!)), 0);
		assert.ok(error < 1e-6, `clip processing must preserve the detector timing; sample error ${error}`);
	});
}
