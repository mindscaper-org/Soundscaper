/* SPDX-License-Identifier: AGPL-3.0-only */

import { IDLE_EFFECT_CONTROL_MESSAGE } from '../idle-effect-processing.ts';

interface IdleContext {
	enabled: boolean;
	readonly nodes: Set<WeakRef<AudioWorkletNode>>;
	shared?: SharedArrayBuffer;
}

const engines = new WeakMap<object, boolean>();
const contexts = new WeakMap<BaseAudioContext, IdleContext>();
const registrations = new WeakMap<AudioNode, { state: IdleContext; node: WeakRef<AudioWorkletNode> }>();

function contextState(context: BaseAudioContext): IdleContext {
	let state = contexts.get(context);
	if (!state) {
		// Offline/export contexts do not inherit a playback preference implicitly.
		state = { enabled: false, nodes: new Set() };
		contexts.set(context, state);
	}
	return state;
}

export function setEngineIdleEffectProcessing(engine: object & { readonly context?: BaseAudioContext | null }, enabled: boolean): void {
	engines.set(engine, enabled);
	if (engine.context) bindIdleEffectContext(engine, engine.context);
}

export function bindIdleEffectContext(engine: object, context: BaseAudioContext): void {
	const enabled = engines.get(engine);
	if (enabled === undefined) return;
	const state = contextState(context);
	state.enabled = enabled;
	if (state.shared) Atomics.store(new Int32Array(state.shared), 0, state.enabled ? 1 : 0);
	for (const ref of state.nodes) {
		const node = ref.deref();
		if (!node) { state.nodes.delete(ref); continue; }
		try { node.port.postMessage({ type: IDLE_EFFECT_CONTROL_MESSAGE, enabled: state.enabled }); }
		catch { releaseIdleEffectNode(node); }
	}
}

export function registerIdleEffectNode(context: BaseAudioContext, node: AudioNode): void {
	const processor = node as AudioWorkletNode;
	if (typeof processor.port?.postMessage !== 'function' || registrations.has(node)) return;
	const state = contextState(context);
	const ref = new WeakRef(processor);
	state.nodes.add(ref);
	registrations.set(node, { state, node: ref });
	processor.port.postMessage({ type: IDLE_EFFECT_CONTROL_MESSAGE, enabled: state.enabled });
}

export function releaseIdleEffectNode(node: AudioNode): void {
	const registration = registrations.get(node);
	if (registration) registration.state.nodes.delete(registration.node);
	registrations.delete(node);
}

/** Workers poll this word because their blocking scheduler cannot receive live messages. */
export function sharedIdleEffectControl(context: BaseAudioContext): SharedArrayBuffer {
	const state = contextState(context);
	state.shared ??= new SharedArrayBuffer(4);
	Atomics.store(new Int32Array(state.shared), 0, state.enabled ? 1 : 0);
	return state.shared;
}
