/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineMeterSnapshot } from '../src/common/editor/engine/public-api.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { MockAudioBuffer, MockAudioContext, MockNode } from './helpers/mock-audio-context.js';

class OppositeChannelContext extends MockAudioContext {
	override createAnalyser() {
		const analyser = super.createAnalyser();
		// A real Analyser's scalar waveform downmix cancels this stereo pair.
		Object.assign(analyser, { getFloatTimeDomainData: (values: Float32Array) => { values.fill(0); } });
		return analyser;
	}
	createChannelSplitter(_width: number) {
		const splitter = new MockNode('splitter');
		const connect = splitter.connect.bind(splitter);
		splitter.connect = (destination: MockNode, output = 0, input = 0) => {
			Object.assign(destination, { getFloatTimeDomainData(values: Float32Array) {
				for (let frame = 0; frame < values.length; frame++) values[frame] = (frame % 2 ? -.4 : .4) * (output ? -1 : 1);
			} });
			return connect(destination, output, input);
		};
		return splitter;
	}
}

for (const mode of ['staffpad', 'cut-preview', 'exact-warp'] as const) test(`${mode} listening meters preserve individual opposite-polarity channels`, async context => {
	const sampleRate = 48_000; const frames = sampleRate * 6;
	const source = createAudioSource({ id: 'source', frameCount: frames, channelCount: 2, sampleRate });
	const project = createSoundscaperProject({ id: `prepared-meters-${mode}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: frames, sourceDurationFrames: frames,
			warpMap: mode === 'exact-warp' ? { feature: 'audio-warp', points: [
				{ outer: 0, source: 0, mode: 'forward' }, { outer: frames, source: frames, mode: 'forward' },
			] } : undefined })], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	const device = new OppositeChannelContext();
	const readings: EngineMeterSnapshot[] = [];
	const engine = createAudioEditorEngine({ audioContextFactory: () => device as unknown as AudioContext,
		offlineAudioContextFactory: null, audioWarpRealtimeAcceleration: false, meterInterval: 10,
		softwareRenderer: options => ({ sampleRate, channels: [new Float32Array(Number(options.endFrame) - Number(options.startFrame)).fill(.4),
			new Float32Array(Number(options.endFrame) - Number(options.startFrame)).fill(-.4)] }),
		onMeter: reading => { readings.push(reading); } });
	context.after(async () => { await engine.dispose(); });
	engine.loadProject(project, new Map([['source', new MockAudioBuffer(2, frames, sampleRate) as unknown as AudioBuffer]]));
	if (mode === 'staffpad') await engine.playAtSpeed(1, { preservePitch: true, pitchPreserver: channels => Promise.resolve(channels) });
	else if (mode === 'cut-preview') await engine.playCutPreview({ startFrame: 3 * sampleRate, endFrame: 4 * sampleRate, trackIds: ['track'] });
	else await engine.play();
	await new Promise<void>(resolve => { setTimeout(resolve, 40); });
	const reading = readings.at(-1);
	assert.ok(reading);
	assert.ok(reading.master.peak > .39, 'audible opposite-polarity stereo must not be reported as a silent mono downmix');
	const master = reading.productionMeters?.find(candidate => candidate.strip.kind === 'master');
	assert.ok(master);
	assert.equal(master.channels.length, 2);
	assert.ok(master.channels.every(channel => channel.peak > .39 && channel.rms > .39));
	assert.deepEqual(master.channels.map(channel => channel.label), ['L', 'R']);
});
