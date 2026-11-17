/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';

for (const mode of ['individual', 'bypassed', 'mix-down'] as const) test(`pre-fader ${mode} printing respects a clip's stereo reverb`, async context => {
	const factory = createNodeWebAudioEngineFactory(context);
	const { controller, store } = await controllerSession(context, { engine: factory.createEngine(), engineFactory: factory.createEngine });
	const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48000, channelCount: 1, frameCount: 4800 });
	const pcm = new Float32Array(4800); pcm[0] = .5;
	const writer = await store.beginSourceWrite('source', source); await writer.write([pcm]); await writer.commit();
	const original = createSoundscaperProject({ sampleRate: 48000, sources: [source],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800, effectsActive: mode !== 'bypassed', effects: [createEffect('reverb', { params: { duration: .05, mix: 1 } })] }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'], effectsActive: false }],
	});
	const project = createSoundscaperProject({ ...original, mixer: { ...original.mixer,
		sends: [{ id: 'pre', name: 'Pre', channelCount: 1, color: '#808080', gain: 0, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] }],
		edges: [...original.mixer.edges, { id: 'pre-send', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: 'pre' },
			position: 'pre-fader', level: 1, enabled: true, channelMap: [0] }],
	} });
	await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(0, 4800, { trackIds: ['voice'] });
	if (mode === 'individual') {
		const before = clipboardProject(controller.project);
		await assert.rejects(controller.actions.track.mixAndRender({ mixDown: false, renderEffects: true, replaceOriginals: true }), /pre-fader.*stereo reverb/iu);
		assert.deepEqual(clipboardProject(controller.project), before);
	} else {
		const printed = await controller.actions.track.mixAndRender({ mixDown: mode === 'mix-down', renderEffects: true, replaceOriginals: true }); assert.ok(printed);
		const result = clipboardProject(controller.project), clip = result.clips.find(clip => clip.id === printed.clipId)!;
		const output = result.sources.find(source => source.id === clip.sourceId)!; assert.ok(output.kind === 'audio');
		assert.equal(output.channelCount, mode === 'mix-down' ? 2 : 1);
		if (mode === 'mix-down') {
			const channels = await readCustodyPcm(store, output);
			assert.ok(channels[0]!.some((value, frame) => Math.abs(value - channels[1]![frame]!) > .001));
		}
	}
});
