/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioWorkletLoadOnce } from '../audio-worklet-load-once.ts';
import { initialAutoTuneControlSchedules } from './auto-tune-control.ts';
import { autoTuneRealtimeGeometry } from '../first-party-effects/auto-tune/realtime-contract.ts';

const modules = new WeakMap<BaseAudioContext, WebAssembly.Module>();
const nodes = new WeakSet<AudioWorkletNode>();
const worklet = createAudioWorkletLoadOnce(async context => {
	const runtime = await import('../staffpad/runtime.js');
	const module = await runtime.loadStaffPadWasmModule();
	const url = import.meta.env?.DEV || import.meta.env?.PROD
		? (await import('../first-party-effects/auto-tune/worklet.ts?worker&url')).default
		: new URL('../first-party-effects/auto-tune/worklet.ts', import.meta.url);
	await context.audioWorklet.addModule(String(url));
	modules.set(context, module);
});

export async function ensureAutoTuneWorklet(context: BaseAudioContext): Promise<void> {
	if (!context.audioWorklet?.addModule || typeof globalThis.AudioWorkletNode !== 'function') throw new Error('This browser cannot run Auto-Tune in realtime.');
	await worklet.ensure(context);
}

interface WorkletNodeConstructor {
	new (context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions): AudioWorkletNode;
}

export function createAutoTuneNode(context: BaseAudioContext, WorkletNode: WorkletNodeConstructor | null,
	params: Record<string, unknown>, channelCount: number, latencyFrames = 0): AudioWorkletNode {
	const module = modules.get(context);
	if (!worklet.isLoaded(context) || !module || !WorkletNode) throw new Error('The Auto-Tune processor was not loaded.');
	autoTuneRealtimeGeometry(context.sampleRate, channelCount);
	const node = new WorkletNode(context, 'kw-auto-tune', {
		numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channelCount],
		channelCount, channelCountMode: 'explicit', channelInterpretation: 'discrete',
		processorOptions: { params, channelCount, staffPadWasmModule: module,
			controlSchedules: initialAutoTuneControlSchedules(context, String(params.controlTrackId || ''), latencyFrames) },
	});
	nodes.add(node);
	return node;
}

export function disposeAutoTuneNode(node: AudioNode): void {
	const processor = node as AudioWorkletNode;
	if (!nodes.delete(processor)) return;
	try { processor.port.postMessage({ type: 'dispose' }); }
	catch { /* The context may already have closed. */ }
}
