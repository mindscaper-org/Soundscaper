/* SPDX-License-Identifier: AGPL-3.0-only */

import { IDLE_EFFECT_CONTROL_MESSAGE } from '../idle-effect-processing.ts';
import { effectAutoIdleEnabled, type EffectAutoIdleOverride } from '../effect-auto-idle-preferences.ts';

interface IdleSettings {
	enabled: boolean;
	overrides: readonly EffectAutoIdleOverride[];
}
interface IdleContext extends IdleSettings {
	readonly nodes: Set<WeakRef<AudioWorkletNode>>;
	readonly shared: Map<string, SharedArrayBuffer>;
}

const engines = new WeakMap<object, IdleSettings>();
const contexts = new WeakMap<BaseAudioContext, IdleContext>();
const registrations = new WeakMap<AudioNode, { state: IdleContext; node: WeakRef<AudioWorkletNode>; key: string }>();

function contextState(context: BaseAudioContext): IdleContext {
	let state = contexts.get(context);
	if (!state) {
		// Offline/export contexts do not inherit a playback preference implicitly.
		state = { enabled: false, overrides: [], nodes: new Set(), shared: new Map() };
		contexts.set(context, state);
	}
	return state;
}

function enabledFor(state: IdleSettings, key: string): boolean {
	return effectAutoIdleEnabled({ suspendIdleEffectProcessing: state.enabled, effectAutoIdleOverrides: state.overrides }, key);
}

function publishNode(state: IdleContext, node: AudioWorkletNode, key: string): void {
	node.port.postMessage({ type: IDLE_EFFECT_CONTROL_MESSAGE, enabled: enabledFor(state, key) });
}

export function setEngineIdleEffectProcessing(engine: object & { readonly context?: BaseAudioContext | null }, enabled: boolean,
	overrides: readonly EffectAutoIdleOverride[] = []): void {
	engines.set(engine, { enabled, overrides });
	if (engine.context) bindIdleEffectContext(engine, engine.context);
}

export function bindIdleEffectContext(engine: object, context: BaseAudioContext): void {
	const settings = engines.get(engine);
	if (!settings) return;
	const state = contextState(context);
	state.enabled = settings.enabled;
	state.overrides = settings.overrides;
	for (const [key, control] of state.shared) Atomics.store(new Int32Array(control), 0, enabledFor(state, key) ? 1 : 0);
	for (const ref of state.nodes) {
		const node = ref.deref();
		if (!node) { state.nodes.delete(ref); continue; }
		try { publishNode(state, node, registrations.get(node)?.key ?? ''); }
		catch { releaseIdleEffectNode(node); }
	}
}

export function registerIdleEffectNode(context: BaseAudioContext, node: AudioNode, key = ''): void {
	const processor = node as AudioWorkletNode;
	if (typeof processor.port?.postMessage !== 'function' || registrations.has(node)) return;
	const state = contextState(context);
	const ref = new WeakRef(processor);
	state.nodes.add(ref);
	registrations.set(node, { state, node: ref, key });
	publishNode(state, processor, key);
}

export function releaseIdleEffectNode(node: AudioNode): void {
	const registration = registrations.get(node);
	if (registration) registration.state.nodes.delete(registration.node);
	registrations.delete(node);
}

/** Workers poll a word per effect type because their blocking schedulers cannot receive live messages. */
export function sharedIdleEffectControl(context: BaseAudioContext, key = ''): SharedArrayBuffer {
	const state = contextState(context);
	let control = state.shared.get(key);
	if (!control) {
		control = new SharedArrayBuffer(4);
		state.shared.set(key, control);
	}
	Atomics.store(new Int32Array(control), 0, enabledFor(state, key) ? 1 : 0);
	return control;
}

export function sharedIdleEffectControls(context: BaseAudioContext, types: readonly string[]): Readonly<Record<string, SharedArrayBuffer>> {
	return Object.fromEntries([...new Set(types)].map(type => [type, sharedIdleEffectControl(context, type)]));
}
