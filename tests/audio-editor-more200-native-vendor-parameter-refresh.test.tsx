/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { SoundscaperNativeEffectManagePanel } from '../src/common/editor/ui/dialogs/SoundscaperNativeEffectPanels.tsx';
import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from '../src/common/editor/ui/soundscaper-native-services-copy.ts';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE, reduceSoundscaperNativeServicesDialog,
	type SoundscaperNativeServicesDialogState } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import { acceptNativePluginPortOffer, createNativePluginEffectNode, registerNativePluginRuntimeIdentity,
	releaseNativePluginRuntime } from '../src/common/editor/native-plugin-realtime-node.js';
import { NATIVE_PLUGIN_CONTROL as CONTROL } from '../src/common/editor/native-plugin-realtime-contract.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('closing a vendor window refreshes generated controls from the edited native instance', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorNode = globalThis.AudioWorkletNode;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let nativeValue = .25;
	class NativeControlPort {
		onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null;
		start(): void {}
		postMessage(message: Record<string, unknown>): void {
			const reply = (fields: Record<string, unknown>): void => {
				queueMicrotask(() => this.onmessage?.({ data: { requestId: message.requestId, ...fields } }));
			};
			if (message.type === CONTROL.attach) reply({ type: CONTROL.attached, generation: 1 });
			if (message.type === CONTROL.capabilities) reply({ type: CONTROL.capabilitiesResult, parameterCount: 1, hasVendorUi: true });
			if (message.type === CONTROL.describeParameters) reply({ type: CONTROL.parameters, parameters: [
				{ index: 0, id: 'gain', name: 'Gain', label: '', minimumValue: 0, maximumValue: 1, defaultValue: .25, flags: 8 },
			] });
			if (message.type === CONTROL.readParameter) reply({ type: CONTROL.parameterValue, index: 0, value: nativeValue });
		}
	}
	class NativeNode {
		readonly port = new NativeControlPort();
		disconnect(): void {}
	}
	globalThis.AudioWorkletNode = NativeNode as unknown as typeof AudioWorkletNode;
	const instanceId = 'vendor-refresh';
	registerNativePluginRuntimeIdentity(instanceId, 'clap');
	acceptNativePluginPortOffer({ instanceId, purpose: 'plugin-rpc', transport: 'message-port',
		portContractVersion: 1, generation: 1 }, [{ postMessage() {}, close() {} }]);
	createNativePluginEffectNode({ sampleRate: 48_000 }, { params: { instanceId } });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let state: SoundscaperNativeServicesDialogState = { ...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
		pluginInstance: { instanceId, entryId: 'gain', stablePluginId: 'org.test.gain', format: 'clap', binarySha256: 'a'.repeat(64),
			inputChannels: 2, outputChannels: 2, state: 'ready', enabled: true, bypassed: false, latencySamples: 0 } };
	const render = async (): Promise<void> => {
		await act(async () => { root.render(<SoundscaperNativeEffectManagePanel copy={SOUNDSCAPER_NATIVE_SERVICES_COPY}
			state={state} disabled={false} perform={() => {}} mode="use" />); });
	};
	try {
		await render();
		assert.equal(dom.one('output').textContent, '25%');
		state = reduceSoundscaperNativeServicesDialog(state, { type: 'settled',
			action: { type: 'open-plugin-vendor-ui', instanceId },
			result: { pluginVendorWindow: { instanceId, windowHandleId: 'window-1', surface: 'helper-owned-top-level' } },
		});
		await render();
		// The helper's native editor changes the same parameter the generated
		// controls read through the real renderer/worklet RPC adapter.
		nativeValue = .75;
		state = reduceSoundscaperNativeServicesDialog(state, { type: 'settled',
			action: { type: 'close-plugin-vendor-ui', instanceId, windowHandleId: 'window-1' },
			result: { pluginVendorWindow: null },
		});
		await render();
		assert.equal(dom.one('output').textContent, '75%');
		assert.equal(dom.one('[data-native-plugin-parameter]').getAttribute('aria-valuetext'), '75%');
	} finally {
		await act(async () => { root.unmount(); });
		releaseNativePluginRuntime(instanceId);
		globalThis.AudioWorkletNode = priorNode;
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
