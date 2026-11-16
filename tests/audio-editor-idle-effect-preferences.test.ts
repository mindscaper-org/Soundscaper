/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindIdleEffectContext, registerIdleEffectNode, releaseIdleEffectNode, sharedIdleEffectControl } from '../src/common/editor/engine/idle-effect-host.ts';
import { createPreferencesComposition } from '../src/common/editor/controller/preferences/preferences-composition.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';

test('loaded preferences, live edits, failed persistence and factory reset reach audio nodes and workers', async () => {
	const state = { preferences: createAudioEditorPreferencesV1(), preferencesReadOnly: false, timelineView: 'waveform' };
	const context = {} as BaseAudioContext;
	const engine = { context: null as BaseAudioContext | null };
	const messages: { enabled: boolean }[] = [];
	const node = { port: { postMessage(message: { enabled: boolean }) { messages.push(message); } } } as unknown as AudioWorkletNode;
	let fail = false;
	const preferences = createPreferencesComposition({
		productId: 'soundscaper', defaultWorkspace: 'modern', engine, state, lifetime: new EditorControllerLifetime(),
		copy: { preferencesNewerSchema: 'Newer schema', shortcutActionRequired: 'Action required', shortcutConflict: 'Conflict' },
		loadSetting: async () => createAudioEditorPreferencesV1({ advanced: { suspendIdleEffectProcessing: false } }),
		persistSetting: async (key) => { if (fail && key.startsWith('soundscaper:')) throw new Error('disk full'); },
		publish: () => undefined,
	});
	engine.context = context;
	bindIdleEffectContext(engine, context);
	registerIdleEffectNode(context, node, 'delay');
	const word = new Int32Array(sharedIdleEffectControl(context, 'delay'));
	assert.equal(messages.at(-1)?.enabled, true);
	assert.equal(Atomics.load(word, 0), 1);
	await preferences.load();
	assert.equal(messages.at(-1)?.enabled, false);
	assert.equal(Atomics.load(word, 0), 0);
	fail = true;
	await assert.rejects(preferences.service.update({ advanced: { suspendIdleEffectProcessing: true } }), /disk full/u);
	assert.equal(state.preferences.advanced.suspendIdleEffectProcessing, false);
	assert.equal(messages.at(-1)?.enabled, false);
	assert.equal(Atomics.load(word, 0), 0);
	fail = false;
	await preferences.service.revertFactorySettings();
	assert.equal(messages.at(-1)?.enabled, true);
	assert.equal(Atomics.load(word, 0), 1);
	await preferences.service.update({ advanced: { effectAutoIdleOverrides: [{ key: 'delay', name: 'Delay', enabled: false }] } });
	assert.equal(messages.at(-1)?.enabled, false);
	assert.equal(Atomics.load(word, 0), 0);
	fail = true;
	await assert.rejects(preferences.service.update({ advanced: { effectAutoIdleOverrides: [] } }), /disk full/u);
	assert.deepEqual(state.preferences.advanced.effectAutoIdleOverrides, [{ key: 'delay', name: 'Delay', enabled: false }]);
	assert.equal(messages.at(-1)?.enabled, false);
	assert.equal(Atomics.load(word, 0), 0);
	fail = false;
	releaseIdleEffectNode(node);
	const count = messages.length;
	await preferences.service.update({ advanced: { suspendIdleEffectProcessing: false } });
	assert.equal(messages.length, count);
});

test('unbound render contexts keep continuous DSP', () => {
	const context = {} as BaseAudioContext;
	const messages: { enabled: boolean }[] = [];
	const node = { port: { postMessage(message: { enabled: boolean }) { messages.push(message); } } } as unknown as AudioWorkletNode;
	registerIdleEffectNode(context, node);
	assert.equal(messages.at(-1)?.enabled, false);
	releaseIdleEffectNode(node);
});
