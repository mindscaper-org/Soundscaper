/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePluginPresetAdapter, createNativePluginPresetStatePort, subscribeNativePluginPresetRestores } from '../src/common/editor/controller/effects/native-plugin-preset-runtime.ts';
import { createSerialProjectOperationQueue } from '../src/common/editor/controller/shared/serial-project-operation-queue.ts';
import type { SoundscaperNativePluginHostBridgeV1 } from '../src/common/editor/native-plugin-host-contract.ts';

test('all native formats capture authenticated opaque state after parameter writes and restore it into a fresh instance', async () => {
	for (const format of ['vst3', 'vst2', 'clap', 'au', 'lv2', 'ladspa']) {
		const calls: string[] = [];
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const bridge = {
			captureNativePluginPreset: async () => { calls.push('save'); return { bytes }; },
			restoreNativePluginPreset: async (request: { instanceId: string; bytes: Uint8Array }) => { calls.push(request.instanceId); assert.deepEqual(request.bytes, bytes); },
		} as unknown as SoundscaperNativePluginHostBridgeV1;
		const identity = { instanceId: 'first', format, stablePluginId: 'org.test.effect', binarySha256: 'b'.repeat(64) };
		const first = createNativePluginPresetAdapter(bridge, identity, () => { calls.push('flush'); });
		const preset = await first.read();
		assert.deepEqual(calls, ['flush', 'save']);
		assert.equal(preset.state, 'AQIDBA==', 'the preset carries its own bytes independently of project storage');
		let refreshed = 0;
		const unsubscribe = subscribeNativePluginPresetRestores('second', () => { refreshed++; });
		const second = createNativePluginPresetAdapter(bridge, { ...identity, instanceId: 'second' });
		await second.apply(preset);
		assert.equal(calls.at(-1), 'second'); assert.equal(refreshed, 1);
		await assert.rejects(second.apply({ ...preset, stablePluginId: 'different' }), /different plug-in/u);
		await assert.rejects(second.apply({ ...preset, binarySha256: 'c'.repeat(64) }), /binary version/u);
		await assert.rejects(second.apply({ ...preset, state: {} }), /Invalid/u);
		unsubscribe();
	}
});

test('native preset capture and restore retain their project fence across asynchronous helper work', async () => {
	let current = true, writes = 0;
	let finish!: () => void;
	const fence = { isCurrent: () => current, assertCurrent() { if (!current) throw new Error('Project changed'); } };
	const queue = createSerialProjectOperationQueue(() => fence);
	const port = createNativePluginPresetStatePort({ queue,
		read: async () => { await new Promise<void>(resolve => { finish = resolve; }); return { bytes: new Uint8Array([1]) }; },
		load: async () => { await new Promise<void>(resolve => { finish = resolve; }); },
		persist: async () => { writes++; },
	});
	const capture = port.captureNativePluginPreset({ instanceId: 'first' });
	await new Promise(resolve => setImmediate(resolve));
	current = false; finish();
	await assert.rejects(capture, /Project changed/u);
	current = true;
	const restore = port.restoreNativePluginPreset({ instanceId: 'first', bytes: new Uint8Array([1]) });
	await new Promise(resolve => setImmediate(resolve));
	current = false; finish();
	await assert.rejects(restore, /Project changed/u);
	assert.equal(writes, 0);
});
