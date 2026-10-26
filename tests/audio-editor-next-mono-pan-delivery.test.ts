/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyChannelMap } from '../src/common/editor/engine/project-graph-v21-edges.ts';
import type { MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';

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
