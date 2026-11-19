/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import type { EngineEffect } from '../src/common/editor/engine/types.ts';

for (const transfer of ['paste', 'duplicate'] as const) for (const bypassed of [false, true]) test(`${transfer} preserves an ${bypassed ? 'inactive' : 'active'} clip rack and its audible result`, async context => {
	const factory = createNodeWebAudioEngineFactory(context), engine = factory.createEngine();
	const { controller, store } = await controllerSession(context, { engine });
	const source = createAudioSource({ id: 'source', sampleRate: 48000, channelCount: 1, frameCount: 4800 });
	const pcm = new Float32Array(4800); pcm[250] = .5;
	const writer = await store.beginSourceWrite('source', source); await writer.write([pcm]); await writer.commit();
	const project = createSoundscaperProject({ sampleRate: 48000, sources: [source],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800, effectsActive: !bypassed,
			effects: [createEffect('delay', { id: 'echo', params: { time: .05, feedback: 0, mix: 1 } })] }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }],
	});
	await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(0, 4800, { trackIds: ['voice'] });
	if (transfer === 'paste') {
		controller.actions.edit.copy();
		controller.actions.timeline.clearSelection(); controller.actions.transport.seek(9600);
		await controller.actions.edit.paste();
	} else await controller.actions.edit.duplicate();
	const result = clipboardProject(controller.project), pasted = result.clips.find(clip => clip.id !== 'clip');
	assert.ok(pasted);
	assert.deepEqual(pasted.effects, project.clips[0]!.effects);
	assert.equal(pasted.effectsActive, !bypassed);
	const start = Number(pasted.timelineStartFrame);
	const rendered = await engine.renderMix({ startFrame: start, endFrame: start + 4800, includeTail: false });
	const output = audioBufferChannels(rendered)[0]!;
	const expectedPeak = bypassed ? 250 : 2650;
	assert.ok(Math.abs(output[expectedPeak]!) > .2, 'the pasted audio must keep its original echo timing');
	assert.ok(Math.abs(output[bypassed ? 2650 : 250]!) < .001);
});

for (const mode of ['local', 'missing', 'mapped'] as const) test(`pasted clip controls preserve playable ${mode} guide state`, async context => {
	const foreign = mode !== 'local';
	const factory = createNodeWebAudioEngineFactory(context), engine = factory.createEngine();
	const { controller, store } = await controllerSession(context, { engine });
	const source = createAudioSource({ id: 'source', sampleRate: 48000, channelCount: 1, frameCount: 4800 });
	const writer = await store.beginSourceWrite('source', source); await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
	await controller.actions.project.open(createSoundscaperProject({ sampleRate: 48000, sources: [source],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4800, effects: [createEffect('audacity-auto-duck', { id: 'duck', context: { controlTrackId: 'guide' } })] }],
		tracks: [{ id: 'music', name: 'Music', type: 'audio', clipIds: ['clip'] }, { id: 'guide', name: 'Guide', type: 'audio', clipIds: [] }],
	}));
	controller.actions.timeline.setSelection(0, 4800, { trackIds: mode === 'mapped' ? ['music', 'guide'] : ['music'] }); controller.actions.edit.copy();
	if (foreign) await controller.actions.project.create();
	controller.actions.timeline.clearSelection(); controller.actions.transport.seek(9600);
	await controller.actions.edit.paste();
	const project = clipboardProject(controller.project), pasted = project.clips.find(clip => clip.id !== 'clip')!;
	const effect = (pasted.effects as readonly EngineEffect[])[0]!;
	assert.equal(effect.enabled, mode !== 'missing');
	const guideId = mode === 'missing' ? null : mode === 'local' ? 'guide' : project.tracks.find(track => track.name === 'Guide')!.id;
	assert.equal(effect.context?.controlTrackId, guideId);
	if (mode === 'mapped') assert.notEqual(guideId, 'guide');
	// Read the transferred source body explicitly; playback source preparation is
	// asynchronous after switching projects, while clipboard publication is atomic.
	const sourceDescriptor = project.sources.find(source => source.id === pasted.sourceId)!;
	assert.ok(sourceDescriptor.kind === 'audio');
	const channels = await readCustodyPcm(store, sourceDescriptor);
	const buffer = new AudioBuffer({ numberOfChannels: channels.length, length: channels[0]!.length, sampleRate: sourceDescriptor.sampleRate });
	channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
	engine.loadProject(projectForRuntimeConsumers(project), new Map([[pasted.sourceId, buffer as unknown as globalThis.AudioBuffer]]));
	const start = Number(pasted.timelineStartFrame);
	const rendered = await engine.renderMix({ startFrame: start, endFrame: start + 4800, includeTail: false });
	assert.ok(audioBufferChannels(rendered)[0]!.some(value => Math.abs(value) > .1));
});
