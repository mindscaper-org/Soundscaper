/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createNativePersistentPluginJobRunner } from '../desktop/native-helper-persistent-plugin-job.js';
import NativePluginParameterControls, { type NativePluginParameterRuntime }
	from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

interface Message { readonly data: unknown }
class Port {
	peer: Port | null = null;
	readonly listeners = new Set<(event: Message) => void>();
	postMessage(value: unknown) { queueMicrotask(() => { for (const listener of this.peer?.listeners ?? []) listener({ data: value }); }); }
	on(_type: 'message', listener: (event: Message) => void) { this.listeners.add(listener); }
	off(_type: 'message', listener: (event: Message) => void) { this.listeners.delete(listener); }
	start() {}
	close() {}
}

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
	let sequence = 0;
	let configuredResolve: (() => void) | undefined;
	const configured = new Promise<void>(resolve => { configuredResolve = resolve; });
	const pending = new Map<string, (value: Record<string, unknown>) => void>();
	renderer.on('message', ({ data }) => {
		const value = data as Record<string, unknown>;
		if (value.kind === 'configured') configuredResolve?.();
		pending.get(String(value.requestId))?.(value);
		pending.delete(String(value.requestId));
	});
	const rpc = (kind: string, fields: Readonly<Record<string, unknown>> = {}) => new Promise<Record<string, unknown>>(resolve => {
		const requestId = `request-${++sequence}`;
		pending.set(requestId, resolve);
		renderer.postMessage({ protocolVersion: 1, kind, requestId, ...fields });
	});
	const parameters = Array.from({ length: 32 }, (_, index) => ({ index, id: `parameter-${index}`,
		name: `Parameter ${index}`, label: '', defaultValue: 0.5, minimumValue: 0, maximumValue: 1, flags: 8 }));
	let releaseRead: (() => void) | undefined;
	let enterRead: (() => void) | undefined;
	const readEntered = new Promise<void>(resolve => { enterRead = resolve; });
	const firstRead = new Promise<void>(resolve => { releaseRead = resolve; });
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
				readsBeforeAudio = completedReads; output[0]!.set(input[0]!); return frames;
			},
		}),
	});
	const handle = runner({ grant: { binaryPath: '/effects/gain.so', binaryBytes: 10, binarySha256: 'd'.repeat(64),
		format: 'ladspa', stableId: 'ladspa:gain', identity: { dev: 1, ino: 2 }, persistentPort: {
			portContractVersion: 1, transport: 'message-port', purpose: 'plugin-rpc', streamId: 'e'.repeat(40),
			generation: 1, maximumMessageBytes: 16 * 1024 ** 2, maximumInFlightMessages: 8 } }, ports: [host],
		resourcePolicy: { maximumInputBytes: 16 * 1024 ** 2, maximumJobDurationMs: 60_000,
			maximumRssBytes: 512 * 1024 ** 2, allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false } });
	const runtime: NativePluginParameterRuntime = {
		capabilities: async () => {
			const answer = await rpc('capabilities');
			return { parameterCount: Number(answer.parameterCount), hasVendorUi: answer.hasVendorUi === true };
		},
		describeParameters: async () => (await rpc('parameters')).parameters as typeof parameters,
		readParameter: async (_instanceId, index) => Number((await rpc('parameter-get', { index })).value),
		writeParameter: async () => { throw new Error('No edit is needed to open controls.'); },
	};
	try {
		renderer.postMessage({ protocolVersion: 1, kind: 'configure', sampleRate: 48_000,
			maximumFrames: 128, stateAuthenticationKey: '0'.repeat(64) });
		await configured;
		await act(async () => { root.render(<NativePluginParameterControls instanceId="gain" runtime={runtime} />); });
		await readEntered;
		if (retire) { await act(async () => { root.unmount(); }); mounted = false; }
		const audio = rpc('process', { frameCount: 128, input: [new Float32Array(128).fill(0.25)], output: [new Float32Array(128)] });
		releaseRead?.();
		await act(async () => { assert.equal((await audio).kind, 'processed'); });
		assert.equal(readsBeforeAudio, 1, 'the audio packet must not sit behind the entire generated-control read inventory');
		if (retire) assert.equal(completedReads, 1, 'dismissed generated controls stop loading the remaining inventory');
	} finally {
		releaseRead?.();
		if (mounted) await act(async () => { root.unmount(); });
		renderer.postMessage({ protocolVersion: 1, kind: 'close', reason: 'editor-shutdown' });
		await handle.completion;
		reactGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
