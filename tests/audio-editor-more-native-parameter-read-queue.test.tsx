/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createNativePersistentPluginJobRunner } from '../desktop/native-helper-persistent-plugin-job.js';
import NativePluginParameterControls from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { NativePluginRealtimeProcessor } from '../src/common/editor/native-plugin-realtime-worklet.js';
import { acceptNativePluginPortOffer, createNativePluginEffectNode, registerNativePluginRuntimeIdentity,
	releaseNativePluginRuntime } from '../src/common/editor/native-plugin-realtime-node.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

interface Message { readonly data: unknown }
class Port {
	peer: Port | null = null;
	onmessage: ((event: Message) => void) | null = null;
	readonly listeners = new Set<(event: Message) => void>();
	postMessage(value: unknown) { queueMicrotask(() => {
		this.peer?.onmessage?.({ data: value });
		for (const listener of this.peer?.listeners ?? []) listener({ data: value });
	}); }
	on(_type: 'message', listener: (event: Message) => void) { this.listeners.add(listener); }
	off(_type: 'message', listener: (event: Message) => void) { this.listeners.delete(listener); }
	start() {}
	close() {}
}

interface Processor {
	readonly port: {
		onmessage(event: Readonly<{ data: unknown; ports: readonly Port[] }>): void;
		postMessage(message: unknown): void;
	};
	process(input: Float32Array[][], output: Float32Array[][]): boolean;
}
// The processor's Node fallback port has no DOM declaration. Only its hardware
// message transport is adapted; control validation and RPC forwarding stay real.
const Processor = NativePluginRealtimeProcessor as unknown as new (options: Readonly<{ processorOptions?: unknown }>) => Processor;

for (const retire of [false, true]) test(`${retire ? 'closing' : 'opening'} generated native controls leaves room for audio in the production host queue`, async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let mounted = true;
	const host = new Port(); const renderer = new Port(); host.peer = renderer; renderer.peer = host;
	let configuredResolve: (() => void) | undefined;
	const configured = new Promise<void>(resolve => { configuredResolve = resolve; });
	renderer.on('message', ({ data }) => {
		if (data && typeof data === 'object' && 'kind' in data && data.kind === 'configured') configuredResolve?.();
	});
	const previousNode = globalThis.AudioWorkletNode;
	let processor: Processor | undefined;
	class RuntimeNode {
		readonly processor: Processor;
		readonly port = {
			onmessage: null as ((event: Message) => void) | null,
			postMessage: (data: unknown, ports: Port[] = []) => {
				queueMicrotask(() => this.processor.port.onmessage({ data, ports }));
			},
			start() {},
		};
		constructor(_context: unknown, _name: string, options: Readonly<{ processorOptions?: unknown }>) {
			this.processor = new Processor(options); processor = this.processor;
			this.processor.port.postMessage = data => { queueMicrotask(() => this.port.onmessage?.({ data })); };
		}
		disconnect() {}
	}
	globalThis.AudioWorkletNode = RuntimeNode as unknown as typeof AudioWorkletNode;
	const requests: string[] = [];
	host.on('message', ({ data }) => {
		assert.ok(data && typeof data === 'object' && 'kind' in data && typeof data.kind === 'string');
		requests.push(data.kind);
	});
	const parameters = Array.from({ length: 32 }, (_, index) => ({ index, id: `parameter-${index}`,
		name: `Parameter ${index}`, label: '', defaultValue: 0.5, minimumValue: 0, maximumValue: 1, flags: 8 }));
	let releaseRead: (() => void) | undefined;
	let enterRead: (() => void) | undefined;
	const readEntered = new Promise<void>(resolve => { enterRead = resolve; });
	const firstRead = new Promise<void>(resolve => { releaseRead = resolve; });
	let completeAudio: (() => void) | undefined;
	const audioCompleted = new Promise<void>(resolve => { completeAudio = resolve; });
	let completedReads = 0;
	let readsBeforeAudio = -1;
	const runner = createNativePersistentPluginJobRunner({ addonPath: '/addon.node', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64) }),
		loadAddon: async () => ({ openPluginInstance: () => ({}), closePluginInstance: () => true,
			pluginLatencyFrames: () => 0, pluginCapabilities: () => ({ parameterCount: parameters.length, hasVendorUi: false }),
			describePluginParameters: () => parameters,
			readPluginParameter: async () => {
				if (completedReads === 0) { enterRead?.(); await firstRead; }
				completedReads++; return 0.5;
			},
			processPluginBlock: (_instance: unknown, frames: number, input: readonly Float32Array[], output: readonly Float32Array[]) => {
				readsBeforeAudio = completedReads; output[0]!.set(input[0]!); completeAudio?.(); return frames;
			},
		}),
	});
	const handle = runner({ grant: { binaryPath: '/effects/gain.so', binaryBytes: 10, binarySha256: 'd'.repeat(64),
		format: 'ladspa', stableId: 'ladspa:gain', identity: { dev: 1, ino: 2 }, persistentPort: {
			portContractVersion: 1, transport: 'message-port', purpose: 'plugin-rpc', streamId: 'e'.repeat(40),
			generation: 1, maximumMessageBytes: 16 * 1024 ** 2, maximumInFlightMessages: 8 } }, ports: [host],
		resourcePolicy: { maximumInputBytes: 16 * 1024 ** 2, maximumJobDurationMs: 60_000,
			maximumRssBytes: 512 * 1024 ** 2, allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false } });
	const instanceId = `parameter-queue-${retire ? 'closing' : 'opening'}`;
	try {
		renderer.postMessage({ protocolVersion: 1, kind: 'configure', sampleRate: 48_000,
			maximumFrames: 128, stateAuthenticationKey: '0'.repeat(64) });
		await configured;
		registerNativePluginRuntimeIdentity(instanceId, 'ladspa');
		assert.equal(acceptNativePluginPortOffer({ instanceId, purpose: 'plugin-rpc', transport: 'message-port',
			portContractVersion: 1, generation: 1 }, [renderer]), true);
		createNativePluginEffectNode({ sampleRate: 48_000 }, { params: { instanceId } });
		await act(async () => { root.render(<NativePluginParameterControls instanceId={instanceId} />); });
		assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
		await readEntered;
		assert.equal(requests.filter(kind => kind === 'parameter-get').length, 1,
			'only one generated-control read reaches the host while its first reply is held');
		if (retire) { await act(async () => { root.unmount(); }); mounted = false; }
		assert.ok(processor);
		processor.process([[new Float32Array(128).fill(.25), new Float32Array(128)]],
			[[new Float32Array(128), new Float32Array(128)]]);
		releaseRead?.();
		await act(async () => { await audioCompleted; });
		assert.equal(readsBeforeAudio, 1, 'the audio packet must not sit behind the entire generated-control read inventory');
		if (retire) assert.equal(completedReads, 1, 'dismissed generated controls stop loading the remaining inventory');
		else {
			assert.equal(completedReads, 32);
			assert.equal(dom.container.querySelectorAll('[data-native-plugin-parameter]').length, 32,
				'all generated controls appear after the held read is released');
		}
	} finally {
		releaseRead?.();
		if (mounted) await act(async () => { root.unmount(); });
		releaseNativePluginRuntime(instanceId);
		renderer.postMessage({ protocolVersion: 1, kind: 'close', reason: 'editor-shutdown' });
		await handle.completion;
		globalThis.AudioWorkletNode = previousNode;
		reactGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
