/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import { selectAudioEditorBusyBlock, selectAudioEditorEditBlock } from '../src/common/editor/edit-blocking.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { createMenuActionFixture, findMenuItem } from './helpers/application-menu-fixture.ts';

interface MenuItem { readonly id?: string; readonly disabled?: boolean; readonly onClick?: () => unknown; readonly items?: readonly MenuItem[] }

test('MP50: dismissing a pending Clear Data confirmation cannot admit File New before storage reset finishes', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	let release: () => void = () => undefined, entered: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	const clear = store.clear.bind(store); store.clear = async () => { entered(); await gate; await clear(); };
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	const actions = createAudacityActionRuntime(controller);
	context.after(async () => { release(); await act(async () => root.unmount()); actions.dispose(); await controller.dispose();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); });
	await controller.ready; await controller.actions.project.open(createSoundscaperProject({ id: 'original' }));
	let pending: Promise<unknown> = Promise.resolve();
	function Host() {
		const [open, setOpen] = useState(true);
		return open ? <EditorDialog type="clear" value="" trackId={null} onValueChange={() => undefined}
			controller={controller} snapshot={controller.getSnapshot()} copy={ENGLISH_COPY} locale="en"
			run={(work: () => unknown) => { pending = Promise.resolve(work()); return pending; }} onClose={() => setOpen(false)} /> : null;
	}
	await act(async () => root.render(<Host />));
	const button = (label: string) => { const node = dom.container.querySelectorAll('button').find(value => value.textContent === label); assert.ok(node); return node; };
	await act(async () => { reactProps(button(ENGLISH_COPY.clearData)).onClick(); }); await started;
	await act(async () => { reactProps(button(ENGLISH_COPY.cancel)).onClick(); });
	assert.equal(dom.find('[role="dialog"]'), null, 'the user dismissed the actual pending confirmation');
	const snapshot = controller.getSnapshot();
	const menus = createApplicationMenus({ productId: 'soundscaper', aboutLabel: 'About Soundscaper', capabilities: snapshot.capabilities,
		locale: 'en', copy: ENGLISH_COPY, project: snapshot.project, snapshot, blocked: selectAudioEditorBusyBlock(snapshot).blocked,
		editBlocked: selectAudioEditorEditBlock(snapshot).blocked, showArmControls: false, selectionActive: false, selectedClip: null,
		durationFrames: 0, effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: actions,
		actions: createMenuActionFixture({ newProject: () => controller.actions.project.create({ title: 'New after dismissal' }) }),
	}) as readonly MenuItem[];
	const create = findMenuItem(menus, 'new-project'); assert.ok(create);
	if (!create.disabled) await create.onClick?.();
	const staleFailure = await controller.actions.project.create({ title: 'Queued stale File New' }).then(() => null, (error: unknown) => error);
	release(); await pending;
	assert.ok(staleFailure instanceof DOMException && staleFailure.name === 'AbortError',
		'a File New event queued while the menu was enabled must also lose domain admission');
	assert.equal(create.disabled, true, 'File New must remain disabled while the earlier clear can delete its storage');
	assert.equal(selectAudioEditorBusyBlock(controller.getSnapshot()).blocked, false, 'settling reset releases operation admission');
});
