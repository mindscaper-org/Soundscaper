/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, type ReactElement, type ReactNode } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import AudioEditorMixerPanel from '../src/common/editor/ui/workspace/AudioEditorMixerPanel.jsx';
import { createDefaultMixerGraphV21, type MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';

import { prepareMixerPanelRouting } from '../src/common/editor/ui/workspace/mixer-panel-routing.ts';
import { mixerTrackSurfaceRouteV21 } from '../src/common/editor/mixer-graph-surface-v21.ts';
import { projectStripPanAvailable } from '../src/common/editor/terminal-channel-widths.ts';

interface MeasuredChannel { channelProps: { panDisabled: boolean; effectFooter?: ReactElement<Record<string, unknown>> } }
function findChannels(value: ReactNode): readonly MeasuredChannel[] | null {
	if (!value || typeof value !== 'object') return null;
	if (Array.isArray(value)) { for (const child of value) { const result = findChannels(child); if (result) return result; } return null; }
	const props = (value as ReactElement<{ channels?: readonly MeasuredChannel[]; children?: ReactNode }>).props;
	return props?.channels ?? findChannels(props?.children);
}

async function measureMixer(check: (counts: { sourceReads: number; edgeReads: number; sendReads: number; normalizationReads: number; baselineNormalizationReads: number }, channels: readonly MeasuredChannel[]) => void, compareBaseline = false) {
	const dom = installReactTestDom(); const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let sourceReads = 0, edgeReads = 0, sendReads = 0, normalizationReads = 0;
	const tracks = Array.from({ length: 100 }, (_, index) => ({ id: `t${index}`, name: `Track ${index}`, type: 'audio', clipIds: [`c${index}`] }));
	const graph = createDefaultMixerGraphV21(tracks, 2);
	const send = { id: 'send', name: 'Send', color: '#000000', gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const edges: readonly MixerEdgeV21[] = [...graph.edges, ...tracks.map(track => ({ id: `send:track:${track.id}:mixer-node:send`, kind: 'send' as const, source: { kind: 'track' as const, id: track.id }, destination: { kind: 'mixer-node' as const, id: 'send' }, position: 'post-fader' as const, level: 0.5, enabled: true, channelMap: [0, 1] }))];
	const measuredEdges = new Proxy(edges, { getOwnPropertyDescriptor(target, key) { if (typeof key === 'string' && /^\d+$/u.test(key)) normalizationReads++; return Reflect.getOwnPropertyDescriptor(target, key); }, get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/u.test(key)) edgeReads++; return Reflect.get(target, key, receiver) as unknown; } });
	const project = { id: 'project', masterChannels: 2, tracks, sources: [{ get id() { sourceReads++; return 'source'; }, channelCount: 2 }], clips: tracks.map((track, index) => ({ id: `c${index}`, sourceId: 'source' })), mixer: { ...graph, sends: [send], edges: measuredEdges } };
	const actions = { mixer: {} }; const run = (operation: () => unknown) => operation();
	let channels: readonly MeasuredChannel[] = [];
	function Harness() {
		const tree = AudioEditorMixerPanel({ controller: { actions }, snapshot: { project }, copy: {}, run, showArmControls: false, displayAudioSupported: false, onOpenEffects() {}, automationRuntime: null });
		channels = findChannels(tree) ?? [];
		const before = edgeReads;
		for (const channel of channels) {
			const footer = channel.channelProps.effectFooter;
			if (footer && typeof footer.type === 'function') {
				const Footer = footer.type as (props: Record<string, unknown>) => ReactNode;
				void Footer(footer.props);
			}
		}
		sendReads += edgeReads - before;
		return null;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />));
		const counts = { sourceReads, edgeReads, sendReads, normalizationReads, baselineNormalizationReads: 0 };
		if (compareBaseline) {
			for (const track of tracks) mixerTrackSurfaceRouteV21(project.mixer, track.id, { sourceChannels: 2, masterChannels: 2 });
			counts.baselineNormalizationReads = normalizationReads - counts.normalizationReads;
		}
		check(counts, channels);
	}
	finally { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = prior; if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); }
}

void test('U01 real mixer render resolves terminal strip widths once for every pan control', async t => {
	await measureMixer((counts, channels) => { t.diagnostic(JSON.stringify(counts)); assert.equal(channels.length, 101); assert.equal(channels[0]?.channelProps.panDisabled, false); assert.ok(counts.sourceReads <= 2, JSON.stringify(counts)); });
});
void test('U02 real mixer send controls resolve addresses without repeated graph scans', async t => {
	await measureMixer(counts => { t.diagnostic(JSON.stringify(counts)); assert.equal(counts.sendReads, 0, JSON.stringify(counts)); });
});
void test('U03 real mixer route projection normalizes and partitions graph edges once per render', async t => {
	await measureMixer(counts => { t.diagnostic(JSON.stringify(counts)); assert.equal(counts.normalizationReads, 201, JSON.stringify(counts)); assert.equal(counts.baselineNormalizationReads, 20100); }, true);
});

void test('batch mixer routing matches compact-route authority for advanced, disabled and duplicate edges', () => {
	const tracks = [{ id: 'a', clipIds: ['c'], type: 'audio' }, { id: '__proto__', clipIds: [], type: 'audio' }];
	const base = createDefaultMixerGraphV21(tracks);
	const send = { id: '__proto__', name: 'Send', color: '#000000', gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const edge: MixerEdgeV21 = { id: 'send:track:a:mixer-node:__proto__', kind: 'send', source: { kind: 'track', id: 'a' }, destination: { kind: 'mixer-node', id: '__proto__' }, position: 'post-fader', level: 0.25, enabled: true, channelMap: [0, 1] };
	for (const edges of [[...base.edges, edge], [...base.edges, edge, { ...edge, id: 'advanced' }], [...base.edges, { ...edge, enabled: false }], [...base.edges, { ...edge, channelMap: [-1, 1] }], [{ ...base.edges[0]!, level: 0.5 }, ...base.edges.slice(1), edge]]) {
		const project = { masterChannels: 2, tracks, clips: [{ id: 'c', sourceId: 's' }], sources: [{ id: 's', channelCount: 2 }], mixer: { ...base, sends: [send], edges } };
		const model = prepareMixerPanelRouting(project, tracks);
		for (const track of tracks) assert.deepEqual(model.routes[track.id], mixerTrackSurfaceRouteV21(project.mixer, track.id, { sourceChannels: 2, masterChannels: 2 }));
		assert.deepEqual(model.sendAddress('a', '__proto__'), { kind: 'edge', edgeId: edge.id, parameterId: 'level' });
		assert.equal(model.sendAddress('missing', '__proto__'), null);
		for (const mode of [undefined, 'authored', 'passthrough']) {
			const changed = { ...project, metadata: { adm: { mode } } };
			const next = prepareMixerPanelRouting(changed, tracks);
			for (const strip of [{ kind: 'master' as const }, { kind: 'track' as const, id: 'a' }, { kind: 'mixer-node' as const, id: '__proto__' }]) assert.equal(next.panAvailable(strip), projectStripPanAvailable(changed, strip));
		}
	}
	const legacy = { mixer: { routes: { a: { groupId: 'g' } } } };
	assert.equal(prepareMixerPanelRouting(legacy, tracks).routes, legacy.mixer.routes);
});

void test('batch mixer pan eligibility observes width and ADM edits with one invocation lifetime', () => {
	const tracks = [{ id: 'a', type: 'audio', clipIds: ['c'] }];
	const project = { tracks, masterChannels: 2, clips: [{ id: 'c', sourceId: 's' }], sources: [{ id: 's', channelCount: 6 }], mixer: createDefaultMixerGraphV21(tracks, 2) };
	const strip = { kind: 'track' as const, id: 'a' };
	assert.equal(prepareMixerPanelRouting(project, tracks).panAvailable(strip), false);
	project.sources[0]!.channelCount = 1;
	assert.equal(prepareMixerPanelRouting(project, tracks).panAvailable(strip), true);
	assert.equal(prepareMixerPanelRouting({ ...project, metadata: { adm: { mode: 'authored' } } }, tracks).panAvailable(strip), false);
});
