/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorPreferencesV1, updateAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { createAudioEditorEffectPresets, saveAudioEditorEffectPreset, deleteAudioEditorEffectPreset, listAudioEditorEffectPresets } from '../src/common/editor/effect-presets.js';
import PluginEffectPresetHeader from '../src/common/editor/ui/inspector/PluginEffectPresetHeader.tsx';
import AdvancedPreferencesPage from '../src/common/editor/ui/dialogs/AdvancedPreferencesPage.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('the common overflow checkbox inherits the global choice, pins a user override, and exposes it below the global preference', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<() => void>();
	let snapshot = { preferences: createAudioEditorPreferencesV1(), project: { id: 'project' } };
	const update = (patch: Record<string, unknown>) => {
		snapshot = { ...snapshot, preferences: updateAudioEditorPreferencesV1(snapshot.preferences, patch) };
		for (const listener of listeners) listener();
	};
	const controller = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		actions: { preferences: { update }, effects: { presets: { list: () => [], save: async () => ({}) } } } };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = (preferences = false) => root.render(preferences
		? <AdvancedPreferencesPage controller={controller} preferences={snapshot.preferences} copy={ENGLISH_COPY} run={operation => { void operation(); }} />
		: <PluginEffectPresetHeader controller={controller} copy={ENGLISH_COPY} effectType="delay" name="Delay" resetKey="delay-instance"
			realtime read={() => ({ time: 1 })} apply={() => undefined} />);
	const open = async () => {
		await act(async () => { reactProps(dom.container.querySelectorAll('.effect-header__icon-button').at(-1)!).onClick({}); });
		const item = dom.container.ownerDocument.body.querySelectorAll('[role="menuitemcheckbox"]').find(node => node.textContent.includes('Auto-idle'));
		assert.ok(item); return item;
	};
	try {
		await act(async () => render());
		assert.equal((await open()).getAttribute('aria-checked'), 'true');
		await act(async () => { update({ advanced: { suspendIdleEffectProcessing: false } }); });
		let item = dom.container.ownerDocument.body.querySelectorAll('[role="menuitemcheckbox"]')[0];
		assert.equal(item.getAttribute('aria-checked'), 'false');
		await act(async () => { reactProps(item).onClick({}); await Promise.resolve(); });
		assert.deepEqual(snapshot.preferences.advanced.effectAutoIdleOverrides, [{ key: 'delay', name: 'Delay', enabled: true }]);
		await act(async () => { update({ advanced: { suspendIdleEffectProcessing: true } }); update({ advanced: { suspendIdleEffectProcessing: false } }); });
		assert.equal((await open()).getAttribute('aria-checked'), 'true');
		await act(async () => render(true));
		const override = dom.container.querySelectorAll('[role="checkbox"]').find(node => node.getAttribute('aria-label') === 'Delay');
		assert.ok(override); assert.equal(override.getAttribute('aria-checked'), 'true');
		const inherit = dom.container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === 'Use global preference: Delay');
		assert.ok(inherit);
		await act(async () => { reactProps(inherit).onClick({}); });
		assert.deepEqual(snapshot.preferences.advanced.effectAutoIdleOverrides, []);
		await act(async () => render());
		item = await open(); assert.equal(item.getAttribute('aria-checked'), 'false');
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
});

test('the shared plug-in header saves and restores presets and exposes realtime bypass', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<() => void>();
	let collection = createAudioEditorEffectPresets();
	let snapshot = { preferences: createAudioEditorPreferencesV1(), project: { id: 'project' }, revision: 0 };
	let gain = 0.25, enabled = true;
	const publish = () => { snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const listener of listeners) listener(); };
	const controller = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		actions: { preferences: { update: () => undefined }, effects: { presets: {
			list: (type: string) => listAudioEditorEffectPresets(collection, type),
			save: async (options: Record<string, unknown>) => { const result = saveAudioEditorEffectPreset(collection, { ...options, idFactory: () => 'saved' }); collection = result.state; publish(); return result.preset; },
			delete: async (id: string) => { collection = deleteAudioEditorEffectPreset(collection, id); publish(); },
		} } } };
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<PluginEffectPresetHeader controller={controller} copy={ENGLISH_COPY}
			effectType={'plugin:["nyquist","gain"]'} name="Gain" resetKey="instance" realtime enabled={enabled}
			onEnabledChange={next => { enabled = next; }} read={() => ({ gain })} apply={params => { gain = Number(params.gain); }} />));
		const power = dom.one('.toggle-button');
		await act(async () => { reactProps(power).onClick({}); });
		assert.equal(enabled, false);
		await act(async () => { reactProps(dom.container.querySelectorAll('.effect-header__icon-button')[0]).onClick({}); });
		const saveAs = dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]').find(node => node.textContent === 'Save as new preset');
		assert.ok(saveAs); await act(async () => { reactProps(saveAs).onClick({}); });
		const input = dom.container.ownerDocument.body.querySelectorAll('input').find(node => reactProps(node).value !== undefined);
		assert.ok(input);
		await act(async () => { reactProps(input).onChange({ target: { value: 'Quiet' }, currentTarget: { value: 'Quiet' } }); });
		const form = dom.container.ownerDocument.body.querySelectorAll('form')[0];
		await act(async () => { reactProps(form).onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); });
		assert.equal(collection.presets.length, 1);
		assert.deepEqual(collection.presets[0].params, { gain: 0.25 });
		gain = 1;
		await act(async () => { reactProps(dom.container.querySelectorAll('.effect-header__icon-button')[1]).onClick({}); await Promise.resolve(); });
		assert.equal(gain, 0.25);
		await act(async () => { reactProps(dom.container.querySelectorAll('.effect-header__icon-button')[2]).onClick({}); await Promise.resolve(); });
		assert.equal(collection.presets.length, 0);
	} finally { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
