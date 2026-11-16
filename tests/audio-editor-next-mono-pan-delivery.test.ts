/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChannelMap } from '../src/common/editor/engine/project-graph-v21-edges.ts';
import type { MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { assertNativeRenderRoundtrip } from './helpers/native-render-custody.ts';

class Node {
	channelCount = 2;
	channelCountMode = 'max';
	channelInterpretation = 'speakers';
	readonly targets: Node[] = [];
	connect(target: Node): Node { this.targets.push(target); return target; }
}

const edge: MixerEdgeV21 = { id: 'mono-assignment', kind: 'assignment', source: { kind: 'track', id: 'voice' },
	destination: { kind: 'master' }, enabled: true, position: 'post-fader', level: 1, channelMap: [0] };

function map(sourceWidth: number, declaredWidth: number, destinationWidth: number, channelMap = edge.channelMap) {
	const created: Node[] = [];
	const create = (): Node => { const node = new Node(); created.push(node); return node; };
	const context = { createGain: create, createChannelSplitter: create, createChannelMerger: create } as unknown as BaseAudioContext;
	const input = new Node();
	const output = applyChannelMap(context, [], input as unknown as AudioNode, sourceWidth, destinationWidth,
		{ ...edge, channelMap }, declaredWidth) as unknown as Node;
	return { input, output, created };
}

test('a mono destination folds both runtime panner channels of its declared mono source', () => {
	const { input, output, created } = map(2, 1, 1);
	assert.equal(created.length, 1, 'one native downmix replaces a splitter selecting only the left side');
	assert.deepEqual(input.targets, [output]);
	assert.equal(output.channelCount, 1);
	assert.equal(output.channelCountMode, 'explicit');
	assert.equal(output.channelInterpretation, 'speakers');
});

test('authored stereo-to-mono channel selection remains explicit', () => {
	const { created } = map(2, 2, 1);
	assert.equal(created.length, 2, 'a genuine stereo source still follows its selected channel map');
});

test('mono silence maps and mono-to-stereo panner routing keep their authored geometry', () => {
	assert.equal(map(2, 1, 1, [-1]).created.length, 2);
	const stereo = map(2, 1, 2, [0, 0]);
	assert.equal(stereo.output, stereo.input);
	assert.equal(stereo.created.length, 0);
	const mono = map(1, 1, 1);
	assert.equal(mono.output, mono.input, 'pre-fader and unpanned mono taps are unchanged');
});

for (const pan of [{ track: 1, master: 0 }, { track: -1, master: 0 }, { track: 0, master: 1 },
	{ track: 0, master: -1 }, { track: 0, master: 0 }, { track: 0, master: 0, automated: true }]) {
	test(`native mono delivery retains both panner sides: track ${pan.track}, master ${pan.master}, automated ${!!pan.automated}`, async context => {
		const source = createAudioSource({ id: 'voice', sampleRate: 48_000, channelCount: 1, frameCount: 24_000 });
		const project = createSoundscaperProject({ id: context.name, masterChannels: 1, sources: [source],
			clips: [createAudioClip({ id: 'voice-clip', sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 })],
			tracks: [createAudioTrack({ id: 'voice-track', pan: pan.track, clipIds: ['voice-clip'] })],
			master: { gain: 1, pan: pan.master, mute: false, solo: false, effectsActive: true, effects: [] },
			automationLanes: pan.automated ? [{ id: 'track-pan', address: { kind: 'strip', strip: { kind: 'track', id: 'voice-track' }, parameterId: 'pan' },
				timebase: 'absolute-samples', points: [{ id: 'left', position: 0, value: -1 }, { id: 'right', position: 24_000, value: 1 }], segments: [{ kind: 'linear' }] }] : [],
		});
		await assertNativeRenderRoundtrip(context, project, new Map([[source.id, [new Float32Array(24_000).fill(.1)]]]), 24_000, output => {
			assert.equal(output.numberOfChannels, 1);
			// Each mono speaker downmix averages the equal-power panner's two sides.
			const fold = (value: number): number => (Math.cos((value + 1) * Math.PI / 4) + Math.sin((value + 1) * Math.PI / 4)) / 2;
			for (const frame of [3_000, 12_000, 21_000]) {
				const trackPan = pan.automated ? -1 + 2 * frame / 24_000 : pan.track;
				const expected = .1 * fold(trackPan) * fold(pan.master);
				assert.ok(expected > .03); assert.ok(Math.abs(output.getChannelData(0)[frame]! - expected) < 1e-5, `frame ${frame}, expected ${expected}`);
			}
		});
	});
}
