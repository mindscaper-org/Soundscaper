/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { parseReaperDocument } from '../src/common/editor/reaper-import.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { reaperSoloDefeatSession } from './helpers/reaper-solo-defeat-fixture.ts';

for (const solo of [false, true]) for (const defeated of [false, true]) for (const muted of [false, true]) {
	test(`REAPER solo defeat keeps its programme audible: solo=${String(solo)}, defeat=${String(defeated)}, mute=${String(muted)}`, async context => {
		const native = createNodeWebAudioEngineFactory(context);
		let ordinal = 0;
		const plan = buildTimelineInterchangeProject(parseReaperDocument(reaperSoloDefeatSession(solo, defeated, muted)), {
			createStableId: prefix => `${prefix}-${++ordinal}`,
		});
		const project = createSoundscaperProject({ ...plan.project, mixer: plan.production.mixer });
		const buffer = new AudioBuffer({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
		buffer.getChannelData(0).fill(.25);
		const engine = native.createEngine();
		engine.loadProject(projectForRuntimeConsumers(project), new Map([[project.sources[0]!.id, buffer as unknown as globalThis.AudioBuffer]]));
		const output = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
		await engine.dispose();
		const audible = output.some(channel => channel.some(value => Math.abs(value) > .01));
		assert.equal(audible, !muted && (!solo || defeated));
		if (!solo) assert.equal(project.tracks[1]!.solo, false, 'solo defeat alone must not start a new solo');
	});
}
