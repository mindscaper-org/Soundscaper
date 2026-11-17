/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { ardourPrefaderTrimSession } from './helpers/ardour-prefader-trim-fixture.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const profiles = [
	...[false, true].flatMap(trim => [false, true].flatMap(send => [false, true].map(enabled => ({ trim, send, enabled, discrete: null as 'trim' | 'send' | null })))),
	{ trim: true, send: true, enabled: true, discrete: 'trim' as const },
	{ trim: true, send: true, enabled: true, discrete: 'send' as const },
];
for (const { trim, send, enabled, discrete } of profiles) {
	test(`Ardour pre-fader cue retains trim: trim=${String(trim)}, send=${String(send)}, active=${String(enabled)}, discrete=${String(discrete)}`, async context => {
		let ordinal = 0;
		const plan = buildTimelineInterchangeProject(parseArdourDocument(ardourPrefaderTrimSession(trim, send, enabled, discrete)), {
			createStableId: prefix => `${prefix}-${++ordinal}`,
		});
		const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
		assert.equal(project.mixer.edges.find(edge => edge.kind === 'send')?.level, enabled ? .25 : .5);
		const native = createNodeWebAudioEngineFactory(context);
		const buffer = new AudioBuffer({ numberOfChannels: 1, length: 48000, sampleRate: 48000 }); buffer.getChannelData(0).fill(.25);
		const engine = native.createEngine();
		engine.loadProject(projectForRuntimeConsumers(project), new Map([[project.sources[0]!.id, buffer as unknown as globalThis.AudioBuffer]]));
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 48000, includeTail: false }))[0]!;
		await engine.dispose();
		for (const frame of [12000, 23999, 24000, 36000]) {
			const trimGain = enabled ? trim ? discrete === 'trim' ? frame < 24000 ? .5 : 1 : .5 + .5 * frame / 48000 : .5 : 1;
			const sendGain = send ? discrete === 'send' ? frame < 24000 ? .5 : 1 : .5 + .5 * frame / 48000 : .5;
			assert.ok(Math.abs(pcm[frame]! - .25 * trimGain * sendGain) < .00001, `sample ${String(frame)} must include upstream trim, got ${String(pcm[frame])}`);
		}
	});
}

test('Ardour File Import retains pre-fader trim and send automation on decoded mono media', async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
	try {
		await controller.actions.project.importFiles([
			new File([ardourPrefaderTrimSession(true, true)], 'Trimmed cue.ardour', { type: 'application/xml' }),
			new File([Uint8Array.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true }))], 'voice.wav', { type: 'audio/wav' }),
		]);
		assert.equal(controller.project?.sources[0]?.channelCount, 1);
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 48000, includeTail: false }))[0]!;
		for (const frame of [12000, 24000, 36000]) {
			const gain = .5 + .5 * frame / 48000;
			assert.ok(Math.abs(pcm[frame]! - .25 * gain * gain) < .00001, `decoded mono cue sample ${String(frame)}: ${String(pcm[frame])}`);
		}
	} finally { await controller.dispose(); await native.dispose(); }
});
