/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createEffect } from '../src/common/editor/effects.js';

async function fixture(context: TestContext, stereo = false) {
	const native = createNodeWebAudioEngineFactory(context);
	const { controller, store } = await controllerSession(context, { engine: native.createEngine(), engineFactory: native.createEngine });
	const source = createAudioSource({ id: 'source', storageKey: 'source', frameCount: 4800, sampleRate: 48000, channelCount: 1 });
	const input = new Float32Array(4800); input[4799] = .5;
	const writer = await store.beginSourceWrite('source', source); await writer.write([input]); await writer.commit();
	const project = createSoundscaperProject({ sampleRate: 48000, sources: [source],
		clips: [{ id: 'left-clip', sourceId: source.id, durationFrames: 4800,
			effects: [createEffect('delay', { params: { time: .05, feedback: 0, mix: 1 } })] },
			...stereo ? [{ id: 'right-clip', sourceId: source.id, durationFrames: 4800, gain: 0 }] : []],
		tracks: [{ id: 'left', type: 'audio', clipIds: ['left-clip'] }, ...stereo ? [{ id: 'right', type: 'audio', clipIds: ['right-clip'] }] : []],
	});
	await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(0, 4800, { trackIds: ['left'] });
	return { controller, store };
}

for (const mixDown of [false, true]) test(`${mixDown ? 'combined' : 'individual'} Mix and Render retains clip effect tails in stored PCM`, async context => {
	const { controller, store } = await fixture(context);
	const printed = await controller.actions.track.mixAndRender({ mixDown, renderEffects: true, replaceOriginals: true }); assert.ok(printed);
	const project = clipboardProject(controller.project), clip = project.clips.find(clip => clip.id === printed.clipId)!;
	const source = project.sources.find(source => source.id === clip.sourceId)!; assert.ok(source.kind === 'audio');
	const pcm = await readCustodyPcm(store, source);
	assert.ok(pcm[0]!.subarray(4800).some(value => Math.abs(value) > .1), 'the echo after the last clip must survive printing');
});

test('Make stereo retains clip effect tails from the mono tracks it replaces', async context => {
	const { controller, store } = await fixture(context, true);
	await controller.actions.track.makeStereo('left', 'right');
	const project = clipboardProject(controller.project), clip = project.clips[0]!;
	const source = project.sources.find(source => source.id === clip.sourceId)!; assert.ok(source.kind === 'audio');
	assert.equal(source.channelCount, 2);
	const pcm = await readCustodyPcm(store, source);
	assert.ok(pcm[0]!.subarray(4800).some(value => Math.abs(value) > .1), 'merging the tracks must not cut their clip echo tails');
});
