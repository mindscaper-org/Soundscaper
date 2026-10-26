/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MixerEdgeV21, MixerGraphV21, MixerStripV21 } from '../../src/common/editor/mixer-graph-v21.ts';

export function bus(id: string): MixerStripV21 {
	return { id, name: id, color: 'blue', gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
}
export function graph(overrides: Partial<MixerGraphV21> = {}): MixerGraphV21 {
	return { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [], outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }], edges: [], ...overrides };
}
export function edge(id: string, source: string, destination: MixerEdgeV21['destination']): MixerEdgeV21 {
	return { id, kind: destination.kind === 'effect-sidechain' ? 'sidechain' : 'assignment', source: { kind: 'track', id: source }, destination, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] };
}
export function routeLane(index: number) {
	return { id: `lane-${index}`, address: { kind: 'edge', edgeId: `edge-${index}`, parameterId: 'level' }, timebase: 'absolute-samples', points: [{ id: `point-${index}`, position: 0, value: 0.5 }], segments: [] };
}
