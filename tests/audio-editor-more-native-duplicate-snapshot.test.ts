/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptNativePluginPortOffer, createNativePluginEffectNode, registerNativePluginRuntimeIdentity, releaseNativePluginRuntime } from '../src/common/editor/native-plugin-realtime-node.js';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { quiesceNativePluginState, registerNativePluginStateQuiescence } from '../src/common/editor/native-plugin-state-quiescence.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createSoundscaperCompatibilityController, openSoundscaperCompatibilityFixture } from './helpers/soundscaper-controller-session.ts';

for (const changed of [false, true]) test(`MP60: File Duplicate completes after ${changed ? 'changed' : 'unchanged'} live native state capture`, async () => {
	const environment = await openSoundscaperCompatibilityFixture({
		indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	});
	const controller: ReturnType<typeof createSoundscaperCompatibilityController> = createSoundscaperCompatibilityController(environment, {
		prepareProjectSnapshot: purpose => quiesceNativePluginState(controller, purpose),
	});
	await controller.ready;
	const state = { instanceId: 'duplicate-native-instance', format: 'clap', stablePluginId: 'org.example.effect',
		binarySha256: 'b'.repeat(64), stateBody: body('c'), enabled: true, bypassed: false, continuity: 'live', latencySamples: 0 };
	const priorNode = globalThis.AudioWorkletNode;
	class NativeNode {
		readonly port = { onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
			start() {}, postMessage: (message: Record<string, unknown>) => {
				if (message.type === 'native-plugin-attach') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'native-plugin-attached', generation: 1 } }));
			} };
		disconnect() {}
	}
	globalThis.AudioWorkletNode = NativeNode as unknown as typeof AudioWorkletNode;
	registerNativePluginRuntimeIdentity(state.instanceId, 'clap');
	acceptNativePluginPortOffer({ instanceId: state.instanceId, purpose: 'plugin-rpc', transport: 'message-port', portContractVersion: 1, generation: 1, reportedLatencyFrames: 0 }, [{ postMessage() {}, close() {} }]);
	createNativePluginEffectNode({ sampleRate: 48_000 } as BaseAudioContext, { params: { instanceId: state.instanceId } }, 2);
	await Promise.resolve();
	let capturing = false;
	const unregister = registerNativePluginStateQuiescence(controller, { capture() {
		if (!capturing) return;
		capturing = false;
		if (changed) controller.actions.edit.commit({
			type: 'native-plugin-state/upsert', state: { ...state, stateBody: body('d') },
		}, {}, { skipPlaybackEngine: true });
	} });
	try {
		const original = createSoundscaperProject({ id: 'duplicate-live-native', title: 'Live native', tracks: [{
			id: 'voice', type: 'audio', effects: [{ id: 'native-slot', type: 'native-plugin', enabled: true,
				params: { instanceId: state.instanceId, latencyFrames: 0 }, context: { format: 'clap', stablePluginId: state.stablePluginId, binarySha256: state.binarySha256 } }],
		}], nativePluginStates: [state] });
		await environment.store.saveProject(original);
		await controller.actions.project.openById(original.id);
		assert.equal(controller.getSnapshot().readOnly, false, 'the hosted native project is editable');
		await controller.actions.project.rename('Live native changed');
		capturing = true;
		const result = await controller.actions.project.duplicate('Printed copy');
		assert.ok(result, 'native state capture must not silently cancel Duplicate');
		assert.ok(validateSoundscaperProject(result));
		assert.notEqual(result.id, 'duplicate-live-native');
		assert.equal(result.nativePluginStates[0]?.stateBody.sha256, (changed ? 'd' : 'c').repeat(64));
		assert.equal(controller.project?.id, result.id);
	} finally { await controller.dispose(); unregister(); await environment.close(); releaseNativePluginRuntime(state.instanceId); globalThis.AudioWorkletNode = priorNode; }
});
function body(digit: string) { const sha256 = digit.repeat(64); return { kind: 'native-plugin-state', bodyId: `native-plugin-state:${sha256}`, byteLength: 1, sha256 }; }
