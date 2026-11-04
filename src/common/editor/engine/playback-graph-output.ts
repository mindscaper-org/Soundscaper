/* SPDX-License-Identifier: AGPL-3.0-only */
import { setParam } from './audio-node-utils.ts';
import type { ProjectGraph } from './project-graph.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

const staged = new WeakSet<EngineRuntimeHost>();

export function stagePlaybackOutput(engine: EngineRuntimeHost): void { staged.add(engine); }

/** Each graph has its own audio-clock gate, upstream of the session loudness meter. */
export function createPlaybackGraphOutput(engine: EngineRuntimeHost, context: BaseAudioContext, destination: AudioNode): GainNode {
	const output = context.createGain();
	setParam(output.gain, staged.has(engine) ? 0 : 1, context.currentTime);
	output.connect(destination);
	return output;
}

export function attachPlaybackGraphOutput(graph: ProjectGraph, outputGate: GainNode): ProjectGraph {
	graph.nodes.push(outputGate);
	return Object.assign(graph, { outputGate });
}

export function switchPlaybackGraphOutput(previous: ProjectGraph, next: ProjectGraph, atTime: number): void {
	if (!previous.outputGate || !next.outputGate) throw new Error('Playback graph is missing its replacement gate.');
	setParam(next.outputGate.gain, 1, atTime);
	setParam(previous.outputGate.gain, 0, atTime);
}
