/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createSoundscaperNativeRendererBridge } from '../src/common/editor/ui/soundscaper-native-renderer-bridge.ts';
import type { NativePluginInstanceProjectionV1, NativePluginVendorUiOutcomeV1 } from '../src/common/editor/native-plugin-host-contract.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

type RendererOptions = Parameters<typeof createSoundscaperNativeRendererBridge>[0];
type Ports = Pick<RendererOptions['bridge'], 'setNativePluginBypassed' | 'openNativePluginVendorUi' | 'closeNativePluginVendorUi'>;
const INSTANCE_ID = 'native-effect';

function fixture(context: TestContext, ports: Partial<Ports>) {
	let project = { id: 'initial-tab', revision: 0 };
	const generation = new EditorProjectGeneration();
	generation.activate(project.id);
	const applied: Array<readonly [string, boolean]> = [];
	const controller = {
		get project() { return project; },
		captureProjectGeneration: generation.capture.bind(generation),
		assertProjectGeneration: generation.assertCurrent.bind(generation),
		getSnapshot: () => ({ selectedTrackId: 'effect-track' }),
		actions: {
			effects: { update() {} },
			nativePlugins: {
				commitBinding: () => ({ effectId: INSTANCE_ID }),
				upsert() {},
				setBypassed(_id: string, bypassed: boolean) {
					applied.push([project.id, bypassed]);
					project = { ...project, revision: project.revision + 1 };
				},
			},
		},
	};
	const renderer = createSoundscaperNativeRendererBridge({ bridge: ports as RendererOptions['bridge'],
		engine: { getState: () => ({ state: 'stopped' }) } as RendererOptions['engine'], controller, publishAudioInventories: false });
	context.after(async () => { await renderer.dispose(); });
	return { renderer, applied, switchProject() { project = { id: 'replacement-tab', revision: 0 }; generation.activate(project.id); } };
}

function projection(bypassed: boolean): NativePluginInstanceProjectionV1 {
	return { instanceId: INSTANCE_ID, format: 'vst3', stablePluginId: 'example-filter', binarySha256: 'f'.repeat(64),
		bypassed, latencySamples: 0, inputChannels: 2, outputChannels: 2 } as NativePluginInstanceProjectionV1;
}

test('a plug-in Bypass command completing after a tab switch cannot change the replacement project', async context => {
	const started = deferred<void>(), reply = deferred<NativePluginInstanceProjectionV1>();
	const { renderer, applied, switchProject } = fixture(context, { setNativePluginBypassed() { started.resolve(); return reply.promise; } });
	const request = renderer.bridge.setNativePluginBypassed({ instanceId: INSTANCE_ID, bypassed: true });
	await started.promise;
	switchProject();
	reply.resolve(projection(true));
	await assert.rejects(request, /project changed/iu);
	assert.deepEqual(applied, []);
});

test('rapid Bypass then Enable requests preserve the order the user chose', async context => {
	const started = deferred<void>(), reply = deferred<NativePluginInstanceProjectionV1>();
	const requested: boolean[] = [];
	const { renderer, applied } = fixture(context, { setNativePluginBypassed({ bypassed }) {
		requested.push(bypassed);
		if (!bypassed) return Promise.resolve(projection(false));
		started.resolve();
		return reply.promise;
	} });
	const bypass = renderer.bridge.setNativePluginBypassed({ instanceId: INSTANCE_ID, bypassed: true });
	await started.promise;
	const enable = renderer.bridge.setNativePluginBypassed({ instanceId: INSTANCE_ID, bypassed: false });
	await settle();
	const sentWhilePending = [...requested];
	reply.resolve(projection(true));
	await Promise.all([bypass, enable]);
	assert.deepEqual(sentWhilePending, [true]);
	assert.deepEqual(applied, [['initial-tab', true], ['initial-tab', false]]);
});

test('opening a vendor plug-in window during a tab switch releases the late native window', async context => {
	const started = deferred<void>(), reply = deferred<NativePluginVendorUiOutcomeV1>();
	const closed: Array<Readonly<{ instanceId: string; windowHandleId: string }>> = [];
	const { renderer, switchProject } = fixture(context, {
		openNativePluginVendorUi() { started.resolve(); return reply.promise; },
		closeNativePluginVendorUi(request) { closed.push(request); return Promise.resolve(true); },
	});
	const pending = renderer.bridge.openNativePluginVendorUi({ instanceId: INSTANCE_ID });
	await started.promise;
	switchProject();
	const windowHandleId = 'vendor-window';
	reply.resolve({ status: 'opened', window: { instanceId: INSTANCE_ID, windowHandleId, surface: 'helper-owned-top-level' } });
	await assert.rejects(pending, /project changed/iu);
	assert.deepEqual(closed, [{ instanceId: INSTANCE_ID, windowHandleId }]);
});
