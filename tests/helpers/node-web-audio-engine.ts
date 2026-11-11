/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';
import * as nativeAudio from 'node-web-audio-api';
import { createAudioEditorEngine, type WebAudioEditorEngine } from '../../src/common/editor/engine/runtime-class.ts';
import type { EngineRuntimeOptions } from '../../src/common/editor/engine/lifecycle.ts';

type MessageScalar = string | number | boolean | null;
export type NodeWebAudioWorkletMessage = Readonly<Record<string, MessageScalar>>;

export interface NodeWebAudioWorkletSnapshot {
	readonly name: string;
	readonly processorType: string | null;
	readonly wasmModuleKeys: readonly string[];
	readonly module: boolean;
	readonly messages: readonly NodeWebAudioWorkletMessage[];
	readonly processorErrors: readonly string[];
}

export interface NodeWebAudioEngineSnapshot {
	readonly engines: number;
	readonly offlineContexts: number;
	readonly worklets: readonly NodeWebAudioWorkletSnapshot[];
	readonly disposed: boolean;
}

export interface NodeWebAudioEngineFactory {
	readonly createEngine: (options?: EngineRuntimeOptions) => WebAudioEditorEngine;
	readonly snapshot: () => NodeWebAudioEngineSnapshot;
	/** Dispose controllers first when they have their own teardown hooks. */
	readonly dispose: () => Promise<void>;
}

interface WorkletObservation {
	readonly name: string;
	readonly processorType: string | null;
	readonly wasmModuleKeys: readonly string[];
	readonly messages: NodeWebAudioWorkletMessage[];
	readonly processorErrors: string[];
}

interface NativeContextResource {
	readonly audioContext: BaseAudioContext;
	readonly realtime: AudioContext | null;
	readonly releaseWorklet: () => Promise<void>;
}

let activeFactory: object | null = null;

/** Real native contexts host the shipping graph and worklets; no PCM, loader or readiness substitutes. */
export function createNodeWebAudioEngineFactory(context: TestContext): NodeWebAudioEngineFactory {
	if (activeFactory) throw new Error('Reuse one Node Web Audio factory for concurrent controllers in a test.');
	const owner = {};
	const engines: WebAudioEditorEngine[] = [];
	const nativeContexts: NativeContextResource[] = [];
	const worklets: WorkletObservation[] = [];
	let offlineContexts = 0;
	let closing = false;
	let disposed = false;
	let disposal: Promise<void> | undefined;

	class ObservedAudioWorkletNode extends nativeAudio.AudioWorkletNode {
		constructor(audioContext: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
			super(audioContext, name, options);
			const settings: unknown = options?.processorOptions;
			const entries = settings && typeof settings === 'object' ? Object.entries(settings) : [];
			const wasmModuleKeys = entries.filter(([, value]) => value instanceof WebAssembly.Module).map(([key]) => key);
			const type: unknown = settings && typeof settings === 'object'
				? Reflect.get(settings, 'effectType') ?? Reflect.get(settings, 'type') : null;
			const record: WorkletObservation = {
				name, processorType: typeof type === 'string' ? type : null,
				wasmModuleKeys, messages: [], processorErrors: [],
			};
			worklets.push(record);
			// Passive observation: the production owner decides whether to start its port or await readiness.
			this.port.addEventListener('message', (event: MessageEvent<unknown>) => {
				if (record.messages.length < 128) record.messages.push(messageScalars(event.data));
			});
			this.addEventListener('processorerror', (event: Event) => {
				if (record.processorErrors.length < 128) {
					const message: unknown = Reflect.get(event, 'message');
					record.processorErrors.push(typeof message === 'string' ? message : 'AudioWorklet processor error');
				}
			});
		}
	}

	const globals = {
		AudioContext: nativeAudio.AudioContext,
		OfflineAudioContext: nativeAudio.OfflineAudioContext,
		AudioWorkletNode: ObservedAudioWorkletNode,
		AudioBuffer: nativeAudio.AudioBuffer,
		AudioNode: nativeAudio.AudioNode,
		AudioParam: nativeAudio.AudioParam,
		AudioBufferSourceNode: nativeAudio.AudioBufferSourceNode,
		BaseAudioContext: nativeAudio.BaseAudioContext,
	};
	const previous = new Map<string, PropertyDescriptor | undefined>();
	const restoreGlobals = (): void => {
		for (const [name, descriptor] of [...previous].reverse()) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
		if (activeFactory === owner) activeFactory = null;
	};
	try {
		for (const [name, value] of Object.entries(globals)) {
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
			Object.defineProperty(globalThis, name, { configurable: true, writable: true,
				enumerable: descriptor?.enumerable ?? false, value });
			previous.set(name, descriptor);
		}
		activeFactory = owner;
	} catch (error) { restoreGlobals(); throw error; }

	const createEngine = (options: EngineRuntimeOptions = {}): WebAudioEditorEngine => {
		if (closing) throw new Error('The Node Web Audio factory is disposed.');
		if (options.softwareRenderer != null) throw new TypeError('Node Web Audio must use the shipping native renderer.');
		const engine = createAudioEditorEngine({ ...options,
			audioContextFactory: (settings: AudioContextOptions = {}) => {
				const silentSink = { ...settings, sinkId: { type: 'none' as const } };
				const audioContext = new nativeAudio.AudioContext(silentSink);
				nativeContexts.push({ audioContext, realtime: audioContext,
					releaseWorklet: ownWorkletRelease(audioContext.audioWorklet) });
				return audioContext;
			},
			offlineAudioContextFactory: settings => {
				const audioContext = new nativeAudio.OfflineAudioContext(settings);
				nativeContexts.push({ audioContext, realtime: null,
					releaseWorklet: ownWorkletRelease(audioContext.audioWorklet) });
				offlineContexts += 1;
				return audioContext;
			},
			softwareRenderer: null,
		});
		engines.push(engine);
		return engine;
	};
	const snapshot = (): NodeWebAudioEngineSnapshot => Object.freeze({
		engines: engines.length, offlineContexts, disposed,
		worklets: Object.freeze(worklets.map(record => Object.freeze({
			name: record.name, processorType: record.processorType,
			wasmModuleKeys: Object.freeze([...record.wasmModuleKeys]), module: record.wasmModuleKeys.length > 0,
			messages: Object.freeze([...record.messages]), processorErrors: Object.freeze([...record.processorErrors]),
		}))),
	});
	const dispose = (): Promise<void> => {
		if (!disposal) {
			closing = true;
			disposal = (async () => {
				const errors: unknown[] = [];
				// Retire render/preview borrowers before the original engine and its context.
				for (const engine of [...engines].reverse()) {
					try { await engine.dispose(); } catch (error) { errors.push(error); }
				}
				for (const resource of [...nativeContexts].reverse()) {
					try {
						if (resource.realtime && resource.realtime.state !== 'closed') await resource.realtime.close();
					} catch (error) { errors.push(error); }
					try { await resource.releaseWorklet(); } catch (error) { errors.push(error); }
				}
				restoreGlobals();
				disposed = true;
				if (errors.length) throw new AggregateError(errors, 'Node Web Audio engine cleanup failed.');
			})();
		}
		return disposal;
	};
	context.after(dispose);
	return Object.freeze({ createEngine, snapshot, dispose });
}

/** SDK 2.2 has no public offline close; its worker release otherwise runs only after a successful render. */
function ownWorkletRelease(worklet: AudioWorklet): () => Promise<void> {
	const prototype: object | null = Object.getPrototypeOf(worklet);
	const releaseKey = prototype && Object.getOwnPropertySymbols(prototype)
		.find(key => key.description === 'node-web-audio-api:worklet-release');
	if (!releaseKey) throw new Error('The pinned Node Web Audio worker-release contract is unavailable.');
	const release: unknown = Reflect.get(worklet, releaseKey);
	if (typeof release !== 'function') throw new TypeError('Node Web Audio worker release must be callable.');
	let pending: Promise<void> | undefined;
	const releaseOnce = (): Promise<void> => {
		pending ??= (async () => { const result: unknown = Reflect.apply(release, worklet, []); await result; })();
		return pending;
	};
	// Share the real release between SDK success teardown and fixture failure teardown; no render/ready changes.
	Object.defineProperty(worklet, releaseKey, { configurable: true, value: releaseOnce });
	return releaseOnce;
}

/** Bound observations to immutable scalar metadata; PCM and analysis payloads remain with production. */
function messageScalars(data: unknown): NodeWebAudioWorkletMessage {
	const entries = data && typeof data === 'object' ? Object.entries(data) : [['value', data]];
	return Object.freeze(Object.fromEntries(entries.filter((entry): entry is [string, MessageScalar] => {
		const value: unknown = entry[1];
		return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
	})));
}
