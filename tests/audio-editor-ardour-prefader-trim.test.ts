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
