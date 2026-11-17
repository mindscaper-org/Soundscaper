/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { omfCompositionClockBytes } from './helpers/omf-composition-clock-fixture.ts';

for (const [compositionRate, sourceRate] of [[48000, 44100], [48000, 48000], [44100, 48000]] as const) {
	test(`OMF File Import retains its ${String(compositionRate)}Hz edit clock with ${String(sourceRate)}Hz media`, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		try {
			await controller.actions.project.importFiles([new File([Uint8Array.from(omfCompositionClockBytes(compositionRate, sourceRate))], 'Native clocks.omf', { type: 'application/octet-stream' })]);
			const project = controller.project; assert.ok(project);
			assert.equal(project.sampleRate, compositionRate, 'native source geometry must not replace the declared composition sample clock');
			assert.equal(project.sources[0]!.sampleRate, sourceRate);
			assert.equal(project.clips[0]!.timelineStartFrame, 1);
			assert.equal(project.clips[0]!.durationFrames, compositionRate / 10);
			const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: compositionRate / 10 + 1, includeTail: false }))[0]!;
			assert.ok(Math.abs(pcm[Math.round(compositionRate / 20)]! - .25 / Math.sqrt(2)) < .00001);
		} finally { await controller.dispose(); await native.dispose(); }
	});
}
