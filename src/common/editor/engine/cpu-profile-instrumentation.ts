/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAudioWorkletLoadOnce } from '../audio-worklet-load-once.ts';
import { addNode, connect, type AudioNodeCollection } from './audio-node-utils.ts';
import type { EffectRackOptions } from './effect-rack.ts';
import { effectGraphKey } from './effect-rack-node-registry.ts';
import type { EngineEffect } from './types.ts';

const worklet = createAudioWorkletLoadOnce(async context => {
	const url = import.meta.env?.DEV || import.meta.env?.PROD
		? (await import('./cpu-profile-worklet.ts?worker&url')).default
		: new URL('./cpu-profile-worklet.js', import.meta.url);
	await context.audioWorklet.addModule(String(url));
});
let control: Int32Array<SharedArrayBuffer> | null = null;

/** Instrument only graphs constructed during an explicitly opened profiling session. */
export function retainCpuProfileInstrumentation(): () => void {
	if (control) throw new Error('CPU profiling is already open.');
	const owned = new Int32Array(new SharedArrayBuffer(4));
	Atomics.store(owned, 0, 1);
	control = owned;
	return () => { Atomics.store(owned, 0, 0); if (control === owned) control = null; };
}

export function cpuProfileControl(): SharedArrayBuffer | undefined { return control?.buffer; }

export async function ensureCpuProfileWorklet(context: BaseAudioContext): Promise<void> {
	if (control && 'state' in context && context.constructor.name !== 'OfflineAudioContext') await worklet.ensure(context);
}

export function profileEffectBoundary(context: BaseAudioContext, input: AudioNode, effect: EngineEffect,
	nodes: AudioNodeCollection, options: EffectRackOptions, edge: 'begin' | 'end'): AudioNode {
	if (!control || !worklet.isLoaded(context) || !options.scope || !effect.id) return input;
	const node = addNode(nodes, new AudioWorkletNode(context, 'scape-cpu-boundary', {
		numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max', channelInterpretation: 'discrete',
		processorOptions: { control: control.buffer, label: `scape-cpu:${edge}:${effectGraphKey(options.scope, options.targetId, effect.id)}`, edge },
	}));
	connect(input, node);
	return node;
}
