/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

for (const [productId, expected] of [
	['soundscaper', ['Soundscaper', 'Audacity', 'Music', 'Classic', 'My layout']],
	['framescaper', ['Video editor', 'My layout']],
] as const) test(`${productId} Preferences uses its product presets and keeps saved custom layouts`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const chosen: string[] = [];
	const preferences = createAudioEditorPreferencesV1({ workspace: { activeId: productId === 'framescaper' ? 'video-editor' : 'modern' } });
	preferences.workspace.custom = [{ id: 'mine', name: 'My layout', layout: preferences.workspace }];
	try {
		await act(async () => { root.render(<WorkspacePreferencesDialog productId={productId}
			controller={{ actions: { preferences: { setWorkspace: (id: string) => { chosen.push(id); } } } }}
			snapshot={{ preferences }} copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }}
			menus={[]} run={(operation: () => unknown) => operation()} initialPage="workspace"
			onTogglePanel={() => undefined} onClose={() => undefined} />); });
		const picker = dom.container.ownerDocument.body.querySelectorAll('[role="group"]').find((node) => node.getAttribute('aria-label') === 'Workspace preset');
		assert.ok(picker);
		const trigger = picker.querySelector('button');
		assert.ok(trigger);
		await act(async () => { reactProps(trigger).onClick(); });
		const options = dom.container.ownerDocument.body.querySelectorAll('[role="option"]');
		assert.deepEqual(options.map((option) => option.textContent), [...expected]);
		const custom = options.find((option) => option.textContent === 'My layout');
		assert.ok(custom);
		await act(async () => { reactProps(custom).onClick(); });
		assert.deepEqual(chosen, ['mine']);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

test('actual Soundscaper Preferences creates My layout and a fresh controller retains its complete current layout', async context => {
	const indexedDB = createInstrumentedIndexedDB();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const open = async () => {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createSoundscaperProjectStore({ indexedDB, preferOpfs: false });
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: () => { throw new Error('Global workspace preferences must not render media.'); } });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		return { controller, store };
	};
	const { controller, store } = await open(), fixture = mountControllerDataDom();
	const before = structuredClone(controller.getSnapshot().preferences); let mounted = true;
	function Preferences() {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		return <WorkspacePreferencesDialog productId="soundscaper" controller={controller} snapshot={snapshot}
			copy={ENGLISH_COPY} locale="en" fileService={{ isDesktop: false }} menus={[]} run={fixture.run}
			initialPage="workspace" onTogglePanel={() => assert.fail('No panel is toggled.')} onClose={() => undefined} />;
	}
	try {
		await fixture.render(<Preferences />);
		const group = fixture.dom.container.ownerDocument.body.querySelectorAll('[role="group"]').find(node => node.getAttribute('aria-label') === 'Workspace preset');
		assert.ok(group); const trigger = group.querySelector('button'); assert.ok(trigger);
		await act(async () => { reactProps(trigger).onClick(); });
		assert.deepEqual(fixture.dom.container.ownerDocument.body.querySelectorAll('[role="option"]').map(option => option.textContent), ['Soundscaper', 'Audacity', 'Music', 'Classic']);
		// Closing the native option popup is covered by the retained Preferences workflows.
		await act(async () => { reactProps(trigger).onClick(); });
		const name = fixture.dom.one('[aria-label="Workspace name"]');
		await act(async () => { reactProps(name).onChange({ currentTarget: { value: 'My layout' } }); });
		const create = fixture.dom.container.querySelectorAll('button').find(button => button.textContent === 'Create from current layout'); assert.ok(create);
		await act(async () => { reactProps(create).onClick({ currentTarget: create }); await Promise.resolve(); await fixture.settle(); });
		assert.equal(name.value, ''); assert.equal(create.hasAttribute('disabled'), true);
		assert.match(trigger.textContent, /^My layout/u);
		const after = controller.getSnapshot().preferences, workspace = after.workspace, previous = before.workspace;
		assert.ok(workspace && typeof workspace === 'object' && 'custom' in workspace && 'activeId' in workspace);
		assert.ok(previous && typeof previous === 'object' && 'toolbars' in previous && 'toolbarButtons' in previous && 'panels' in previous);
		assert.ok(Array.isArray(workspace.custom)); const custom: unknown = workspace.custom[0];
		assert.ok(custom && typeof custom === 'object' && 'id' in custom && 'name' in custom && 'layout' in custom);
		assert.equal(typeof custom.id, 'string'); assert.equal(custom.name, 'My layout'); assert.equal(workspace.custom.length, 1);
		assert.notEqual(custom.id, 'modern'); assert.equal(workspace.activeId, custom.id);
		const layout = { toolbars: previous.toolbars, toolbarButtons: previous.toolbarButtons, panels: previous.panels };
		assert.deepEqual(custom.layout, layout);
		assert.deepEqual(after, { ...before, workspace: { ...previous, activeId: custom.id, custom: [{ id: custom.id, name: 'My layout', layout }] } });
		assert.deepEqual(await store.loadSetting('soundscaper:audio-editor-preferences-v1', null), after);
		await fixture.dispose(); mounted = false; await controller.dispose();
		const recipient = await open();
		assert.deepEqual(recipient.controller.getSnapshot().preferences, after, 'a fresh product controller reads the durable complete custom layout');
		assert.deepEqual(await recipient.store.loadSetting('soundscaper:audio-editor-preferences-v1', null), after);
	} finally { if (mounted) await fixture.dispose(); }
});
