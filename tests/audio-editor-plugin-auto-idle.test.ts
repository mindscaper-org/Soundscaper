/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorPreferencesV1, loadAudioEditorPreferencesV1, updateAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { effectAutoIdleEnabled, withEffectAutoIdleOverride } from '../src/common/editor/effect-auto-idle-preferences.ts';
import { effectPluginKey, pluginEffectType } from '../src/common/editor/effect-plugin-identity.ts';
import { bindIdleEffectContext, registerIdleEffectNode, setEngineIdleEffectProcessing, sharedIdleEffectControl } from '../src/common/editor/engine/idle-effect-host.ts';

test('untouched effects follow the global preference while explicit choices persist across global changes and reload', () => {
	const key = effectPluginKey({ type: 'eq' });
	let preferences = createAudioEditorPreferencesV1();
	assert.equal(effectAutoIdleEnabled(preferences.advanced, key), true);
	preferences = updateAudioEditorPreferencesV1(preferences, { advanced: { suspendIdleEffectProcessing: false } });
	assert.equal(effectAutoIdleEnabled(preferences.advanced, key), false);
	preferences = updateAudioEditorPreferencesV1(preferences, { advanced: {
		effectAutoIdleOverrides: withEffectAutoIdleOverride(preferences.advanced, key, 'EQ', true),
	} });
	for (const enabled of [true, false, true, false]) {
		preferences = updateAudioEditorPreferencesV1(preferences, { advanced: { suspendIdleEffectProcessing: enabled } });
		assert.equal(effectAutoIdleEnabled(preferences.advanced, key), true);
		assert.equal(effectAutoIdleEnabled(preferences.advanced, 'delay'), enabled);
	}
	const loaded = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(preferences))).preferences;
	assert.deepEqual(loaded.advanced.effectAutoIdleOverrides, [{ key, name: 'EQ', enabled: true }]);
	const removed = withEffectAutoIdleOverride(loaded.advanced, key, 'EQ', null);
	assert.deepEqual(removed, []);
});

test('plug-in identity is shared across instances and versions but isolated by format and plug-in ID', () => {
	assert.equal(effectPluginKey({ type: 'eq' }), effectPluginKey({ type: 'parametric-eq' }));
	const native = (format: string, stablePluginId = 'synth') => effectPluginKey({ type: 'native-plugin', context: { format, stablePluginId } });
	assert.equal(native('vst3'), pluginEffectType('vst3', 'synth'));
	assert.notEqual(native('vst3'), native('vst2'));
	assert.notEqual(native('vst3'), native('vst3', 'other'));
	assert.notEqual(pluginEffectType('nyquist', 'delay'), 'delay');
});

test('per-plug-in choices update running nodes and worker controls and leave offline contexts continuous', () => {
	const context = {} as BaseAudioContext;
	const engine = { context };
	const messages: boolean[] = [];
	const node = { port: { postMessage(message: { enabled: boolean }) { messages.push(message.enabled); } } } as unknown as AudioWorkletNode;
	setEngineIdleEffectProcessing(engine, false, [{ key: 'delay', name: 'Delay', enabled: true }]);
	registerIdleEffectNode(context, node, 'delay');
	const delay = new Int32Array(sharedIdleEffectControl(context, 'delay'));
	const limiter = new Int32Array(sharedIdleEffectControl(context, 'limiter'));
	assert.equal(messages.at(-1), true);
	assert.equal(Atomics.load(delay, 0), 1);
	assert.equal(Atomics.load(limiter, 0), 0);
	setEngineIdleEffectProcessing(engine, true, [{ key: 'delay', name: 'Delay', enabled: false }]);
	assert.equal(messages.at(-1), false);
	assert.equal(Atomics.load(delay, 0), 0);
	assert.equal(Atomics.load(limiter, 0), 1);
	const renderContext = {} as BaseAudioContext;
	bindIdleEffectContext({}, renderContext);
	registerIdleEffectNode(renderContext, { port: { postMessage() {} } } as unknown as AudioWorkletNode, 'delay');
	assert.equal(Atomics.load(new Int32Array(sharedIdleEffectControl(renderContext, 'delay')), 0), 0);
});

test('override persistence rejects malformed, duplicate, and accessor-backed entries', () => {
	for (const overrides of [null, {}, [{ key: 'delay', name: 'Delay', enabled: 'yes' }],
		[{ key: 'delay', name: 'Delay', enabled: true }, { key: 'delay', name: 'Delay', enabled: false }],
		[{ key: 'delay', name: 'Delay', get enabled() { throw new Error('must not read accessors'); } }]]) {
		assert.throws(() => createAudioEditorPreferencesV1({ advanced: { effectAutoIdleOverrides: overrides } }), /auto.idle/iu);
	}
});
