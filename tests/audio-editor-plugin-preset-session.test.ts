/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginPresetSession, type PluginPresetLibrary } from '../src/common/editor/controller/effects/plugin-preset-session.ts';

test('closing or replacing a plug-in while its state is being read cannot save that state into a different subject', async () => {
	let finish!: (value: Record<string, unknown>) => void;
	let saved = false;
	const library = { save: async () => { saved = true; return { id: 'preset', name: 'name', effectType: 'first', params: {} }; } } as unknown as PluginPresetLibrary;
	const session = createPluginPresetSession({ effectType: 'first', library,
		read: () => new Promise<Record<string, unknown>>(resolve => { finish = resolve; }), apply: () => undefined });
	const pending = session.save('name');
	session.dispose();
	finish({ value: 1 });
	assert.equal(await pending, null);
	assert.equal(saved, false);
});

test('preset application refuses a different plug-in and detaches settings from the library', async () => {
	let applied: Readonly<Record<string, unknown>> | null = null;
	const session = createPluginPresetSession({ effectType: 'first', library: {} as PluginPresetLibrary,
		read: () => ({}), apply: params => { applied = params; } });
	assert.equal(await session.apply({ id: 'other', effectType: 'second', name: 'Other', params: {} }), false);
	assert.equal(applied, null);
	const preset = { id: 'preset', effectType: 'first', name: 'Preset', params: { gain: 1 } };
	assert.equal(await session.apply(preset), true);
	assert.deepEqual(applied, { gain: 1 });
	assert.notEqual(applied, preset.params);
});
