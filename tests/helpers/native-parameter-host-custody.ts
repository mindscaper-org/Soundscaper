/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createNativePersistentPluginJobRunner } from '../../desktop/native-helper-persistent-plugin-job.js';
import { NativePluginRealtimeProcessor } from '../../src/common/editor/native-plugin-realtime-worklet.js';
import { acceptNativePluginPortOffer, createNativePluginEffectNode, registerNativePluginRuntimeIdentity,
	releaseNativePluginRuntime } from '../../src/common/editor/native-plugin-realtime-node.js';
import type { NativePluginParameterDescriptor } from '../../src/common/editor/ui/dialogs/native-plugin-parameter-runtime.ts';

interface Message { readonly data: unknown }
class Port {
	peer: Port | null = null;
	onmessage: ((event: Message) => void) | null = null;
	readonly listeners = new Set<(event: Message) => void>();
	postMessage(value: unknown): void { queueMicrotask(() => {
		this.peer?.onmessage?.({ data: value });
		for (const listener of this.peer?.listeners ?? []) listener({ data: value });
	}); }
	on(_type: 'message', listener: (event: Message) => void): void { this.listeners.add(listener); }
	off(_type: 'message', listener: (event: Message) => void): void { this.listeners.delete(listener); }
	start(): void {}
	close(): void {}
}

interface Processor {
	readonly port: {
		onmessage(event: Readonly<{ data: unknown; ports: readonly Port[] }>): void;
		postMessage(message: unknown): void;
	};
	process(input: Float32Array[][], output: Float32Array[][]): boolean;
}
// Only the hardware port declaration is supplied; the exported processor runs.
const Processor = NativePluginRealtimeProcessor as unknown as new (options: Readonly<{ processorOptions?: unknown }>) => Processor;

/** Real default runtime/processor/host FIFO; the hardware and admitted addon are ports. */
export async function nativeParameterHostCustody(context: TestContext, options: Readonly<{
	instanceId: string; parameters: readonly NativePluginParameterDescriptor[];
	values: readonly number[]; holdFirstRead?: boolean;
}>) {
	const { instanceId, parameters } = options;
	assert.equal(options.values.length, parameters.length);
	const host = new Port(), renderer = new Port(); host.peer = renderer; renderer.peer = host;
	let configuredResolve: (() => void) | undefined;
	const configured = new Promise<void>(resolve => { configuredResolve = resolve; });
	renderer.on('message', ({ data }) => {
		if (data && typeof data === 'object' && 'kind' in data && data.kind === 'configured') configuredResolve?.();
	});
	const previousNode = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	let processor: Processor | undefined;
	class RuntimeNode {
		readonly processor: Processor;
		readonly port = {
			onmessage: null as ((event: Message) => void) | null,
			postMessage: (data: unknown, ports: Port[] = []) => { queueMicrotask(() => this.processor.port.onmessage({ data, ports })); },
			start() {},
		};
		constructor(_context: unknown, _name: string, settings: Readonly<{ processorOptions?: unknown }>) {
			this.processor = new Processor(settings); processor = this.processor;
			this.processor.port.postMessage = data => { queueMicrotask(() => this.port.onmessage?.({ data })); };
		}
		disconnect() {}
	}
	globalThis.AudioWorkletNode = RuntimeNode as unknown as typeof AudioWorkletNode;
	const state = { values: [...options.values], requests: [] as string[], writes: [] as { index: number; value: number }[],
		completedReads: 0, readsBeforeAudio: -1 };
	host.on('message', ({ data }) => {
		assert.ok(data && typeof data === 'object' && 'kind' in data && typeof data.kind === 'string');
		state.requests.push(data.kind);
	});
	let releaseRead: (() => void) | undefined, enterRead: (() => void) | undefined;
	const readEntered = new Promise<void>(resolve => { enterRead = resolve; });
	const firstRead = new Promise<void>(resolve => { releaseRead = resolve; });
	let completeAudio: (() => void) | undefined;
	const audioCompleted = new Promise<void>(resolve => { completeAudio = resolve; });
	const runner = createNativePersistentPluginJobRunner({ addonPath: '/addon.node', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64) }),
		loadAddon: async () => ({ openPluginInstance: () => ({}), closePluginInstance: () => true,
			pluginLatencyFrames: () => 0, pluginCapabilities: () => ({ parameterCount: parameters.length, hasVendorUi: false }),
			describePluginParameters: () => parameters,
			readPluginParameter: async (_instance: unknown, index: number) => {
				if (state.completedReads === 0) { enterRead?.(); if (options.holdFirstRead) await firstRead; }
				state.completedReads++; return state.values[index];
			},
			writePluginParameter: (_instance: unknown, index: number, value: number) => {
				state.values[index] = value; state.writes.push({ index, value }); return value;
			},
			processPluginBlock: (_instance: unknown, frames: number, input: readonly Float32Array[], output: readonly Float32Array[]) => {
				state.readsBeforeAudio = state.completedReads; output[0]!.set(input[0]!); completeAudio?.(); return frames;
			},
		}),
	});
	const handle = runner({ grant: { binaryPath: '/effects/gain.so', binaryBytes: 10, binarySha256: 'd'.repeat(64),
		format: 'ladspa', stableId: 'ladspa:gain', identity: { dev: 1, ino: 2 }, persistentPort: {
			portContractVersion: 1, transport: 'message-port', purpose: 'plugin-rpc', streamId: 'e'.repeat(40),
			generation: 1, maximumMessageBytes: 16 * 1024 ** 2, maximumInFlightMessages: 8 } }, ports: [host],
		resourcePolicy: { maximumInputBytes: 16 * 1024 ** 2, maximumJobDurationMs: 60_000,
			maximumRssBytes: 512 * 1024 ** 2, allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false } });
	let closed = false;
	const dispose = async () => {
		if (closed) return; closed = true;
		try {
			releaseRead?.(); releaseNativePluginRuntime(instanceId);
			renderer.postMessage({ protocolVersion: 1, kind: 'close', reason: 'editor-shutdown' });
			await handle.completion;
		} finally {
			if (previousNode) Object.defineProperty(globalThis, 'AudioWorkletNode', previousNode);
			else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		}
	};
	context.after(dispose);
	try {
		renderer.postMessage({ protocolVersion: 1, kind: 'configure', sampleRate: 48_000,
			maximumFrames: 128, stateAuthenticationKey: '0'.repeat(64) });
		await Promise.race([configured, handle.completion.then(() => { throw new Error('The native host closed before configuration.'); })]);
		registerNativePluginRuntimeIdentity(instanceId, 'ladspa');
		assert.equal(acceptNativePluginPortOffer({ instanceId, purpose: 'plugin-rpc', transport: 'message-port',
			portContractVersion: 1, generation: 1 }, [renderer]), true);
		createNativePluginEffectNode({ sampleRate: 48_000 }, { params: { instanceId } });
		return { instanceId, state, readEntered, releaseReads: () => { releaseRead?.(); }, dispose,
			async processPacket() {
				assert.ok(processor);
				processor.process([[new Float32Array(128).fill(.25), new Float32Array(128)]],
					[[new Float32Array(128), new Float32Array(128)]]);
				await audioCompleted;
			},
		};
	} catch (error) { await dispose(); throw error; }
}
