/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindNativePluginPresetBridge, setNativeRackEffectEnabled } from '../src/common/editor/controller/effects/native-plugin-preset-runtime.ts';
import type { SoundscaperNativePluginHostBridgeV1 } from '../src/common/editor/native-plugin-host-contract.ts';

test('native rack power shares host bypass and repairs a disabled slot only when enabling', async context => {
	const host: unknown[] = [], slots: unknown[] = [];
	const controller = { actions: { effects: { update: (...args: unknown[]) => { slots.push(args); } } } };
	const bridge = { setNativePluginBypassed: async (request: unknown) => { host.push(request); } } as unknown as SoundscaperNativePluginHostBridgeV1;
	context.after(bindNativePluginPresetBridge(controller, bridge));
	const effect = { id: 'slot', enabled: true, params: { instanceId: 'instance' } };
	await setNativeRackEffectEnabled(controller, 'track', 'voice', effect, false, () => true);
	await setNativeRackEffectEnabled(controller, 'track', 'voice', effect, true, () => true);
	assert.deepEqual(host, [{ instanceId: 'instance', bypassed: true }, { instanceId: 'instance', bypassed: false }]);
	assert.deepEqual(slots, [], 'ordinary native bypass must not add a competing rack enabled flag');
	await setNativeRackEffectEnabled(controller, 'track', 'voice', { ...effect, enabled: false }, true, () => true);
	assert.deepEqual(slots, [['track', 'voice', 'slot', { enabled: true }]]);
});

test('native rack power does not publish a late activation or pretend a refused host change succeeded', async context => {
	const slots: unknown[] = [];
	const controller = { actions: { effects: { update: (...args: unknown[]) => { slots.push(args); } } } };
	let current = true;
	const bridge = { setNativePluginBypassed: async () => { current = false; } } as unknown as SoundscaperNativePluginHostBridgeV1;
	const release = bindNativePluginPresetBridge(controller, bridge); context.after(release);
	const effect = { id: 'slot', enabled: false, params: { instanceId: 'instance' } };
	await setNativeRackEffectEnabled(controller, 'track', 'voice', effect, true, () => current);
	assert.deepEqual(slots, []);
	release();
	context.after(bindNativePluginPresetBridge(controller, { setNativePluginBypassed: async () => { throw new Error('host refused'); } } as unknown as SoundscaperNativePluginHostBridgeV1));
	await assert.rejects(setNativeRackEffectEnabled(controller, 'track', 'voice', effect, true, () => true), /host refused/u);
	assert.deepEqual(slots, []);
});
