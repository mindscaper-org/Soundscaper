/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaybackSpectrumSession } from '../src/common/editor/engine/playback-spectrum.ts';
import type { ProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { mixerEndpointKeyV21 } from '../src/common/editor/mixer-signal-edge-v21.ts';

function fixture() {
	const nodes: Array<AudioNode & { disconnected: boolean }> = [];
	let fail = false;
	const node = () => {
		const value = { disconnected: false, connect() {}, disconnect() { value.disconnected = true; } };
		nodes.push(value as unknown as typeof nodes[number]);
		return value as unknown as AudioNode;
	};
	const levels = [-6, -6, -18, -18];
	let created = 0;
	const context = { sampleRate: 48_000, createChannelSplitter: () => node(), createAnalyser: () => {
		if (fail) throw new Error('Failed analyser');
		const channel = created++;
		return Object.assign(node(), { frequencyBinCount: 2048, getFloatFrequencyData(target: Float32Array) {
			target.fill(-Infinity); target[channel < 2 ? 64 : 512] = levels[channel]!;
		} });
	} } as unknown as BaseAudioContext;
	const graph = () => ({ nodes: [], abortController: new AbortController(),
		masterAnalyser: node(), trackAnalysers: new Map([['bass', node()], ['lead', node()]]),
	} as unknown as ProjectGraph);
	const owner = { context: context as BaseAudioContext | null, graph: graph() as ProjectGraph | null };
	return { owner, nodes, graph, levels, created: () => created, fail: () => { fail = true; } };
}

test('playback spectrum taps are lazy, isolated per track and retain channel power', () => {
	const f = fixture();
	const session = createPlaybackSpectrumSession(f.owner);
	assert.equal(f.created(), 0, 'opening a session must not attach taps before sampling');
	const target = new Float32Array(session.fftSize / 2);
	const bass = session.read('bass', target);
	assert.equal(bass?.sampleRate, 48_000);
	assert.equal(target[64], -6);
	assert.equal(target[512], -Infinity);
	assert.equal(session.read('bass', target), bass);
	assert.equal(f.created(), 2, 'repeated reads must reuse the channel taps');
	session.read('lead', target);
	assert.equal(target[64], -Infinity);
	assert.equal(target[512], -18);
	f.levels[2] = -Infinity;
	session.read('lead', target);
	assert.ok(Math.abs(target[512]! - (-18 - 10 * Math.log10(2))) < 0.001);
	const taps = [...f.owner.graph!.nodes.transientNodes!];
	session.release(); session.release();
	assert.equal(f.owner.graph!.nodes.transientNodes!.size, 0);
	assert.ok(taps.every(tap => f.nodes.find(node => node === tap)?.disconnected));
	assert.equal(session.read('bass', target), null);
	assert.ok(target.every(value => value === -Infinity));
});

test('playback spectrum releases old graph taps, follows graph rebuilds and handles stop', () => {
	const f = fixture();
	const session = createPlaybackSpectrumSession(f.owner);
	const target = new Float32Array(session.fftSize / 2);
	session.read('bass', target);
	const oldGraph = f.owner.graph!;
	oldGraph.abortController.abort();
	assert.equal(oldGraph.nodes.transientNodes!.size, 0);
	assert.equal(session.read('bass', target), null);
	f.owner.graph = f.graph();
	assert.ok(session.read('bass', target));
	assert.equal(f.created(), 4);
	const newGraph = f.owner.graph;
	f.owner.graph = null;
	assert.equal(session.read('bass', target), null);
	assert.equal(newGraph.nodes.transientNodes!.size, 0);
	assert.ok(target.every(value => value === -Infinity));
	session.release();
});

test('playback spectrum rejects wrong geometry and cleans up partially created taps', () => {
	const f = fixture();
	const session = createPlaybackSpectrumSession(f.owner);
	assert.throws(() => session.read('bass', new Float32Array(1)), RangeError);
	const target = new Float32Array(session.fftSize / 2);
	assert.equal(session.read('missing', target), null);
	f.fail();
	const initialNodes = f.nodes.length;
	assert.throws(() => session.read('bass', target), /Failed analyser/);
	assert.ok(f.nodes.slice(initialNodes).every(node => node.disconnected));
	assert.equal(f.owner.graph!.nodes.transientNodes!.size, 0);
	session.release();
});

test('playback spectrum taps honor mono and surround strip channel counts', () => {
	for (const width of [1, 6, 32]) {
		const f = fixture();
		const graph = f.owner.graph!;
		const strip = { kind: 'track' as const, id: 'bass' };
		f.owner.graph = { ...graph, productionStripAnalysersV21: new Map([[mixerEndpointKeyV21(strip), {
			strip, output: graph.trackAnalysers.get('bass')!, channelLabels: [],
			analysers: Array.from({ length: width }, () => graph.masterAnalyser!),
		}]]) };
		const session = createPlaybackSpectrumSession(f.owner);
		session.read('bass', new Float32Array(session.fftSize / 2));
		assert.equal(f.created(), width);
		session.release();
		assert.equal(f.owner.graph.nodes.transientNodes!.size, 0);
	}
});
